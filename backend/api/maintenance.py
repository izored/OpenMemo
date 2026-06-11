"""Maintenance API — clear cached previews, reset the workspace."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.db.database import get_db
from backend.db.models import (
    Memo,
    Collection,
    Tag,
    ChatSession,
    Message,
    memo_collections,
    memo_tags,
)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


@router.post("/reclassify-types")
async def reclassify_types(dry_run: bool = False, db: AsyncSession = Depends(get_db)):
    """Re-file every memo to its canonical type (the background sorter, on demand).

    Pass ?dry_run=true to preview the changes without writing. Returns
    {scanned, changed, changes, dry_run}.
    """
    from backend.core.classify import reclassify_all

    return await reclassify_all(db, dry_run=dry_run)


@router.post("/backfill-video-thumbs")
async def backfill_video_thumbnails(db: AsyncSession = Depends(get_db)):
    """Re-run thumbnail extraction for all video memos missing thumbnail_path.

    Uses the same extractor as the ingest path. Skips when ffmpeg isn't
    installed. Returns counts so the caller knows how many succeeded.
    """
    from sqlalchemy import select
    from datetime import datetime
    from backend.core.video import extract_video_thumbnail, ffmpeg_available
    from backend.core.file_paths import resolve_memo_path

    if not ffmpeg_available():
        raise HTTPException(status_code=503, detail="ffmpeg not available on server PATH")

    thumbs_dir = Path(settings.FILES_DIR) / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    rows = (
        await db.execute(
            select(Memo).where(Memo.type == "video", Memo.file_path.isnot(None))
        )
    ).scalars().all()

    processed = 0
    skipped = 0
    failed = 0
    for memo in rows:
        if memo.thumbnail_path and Path(str(memo.thumbnail_path).lstrip("/")).is_absolute() is False:
            # Already has a thumbnail path string; only redo if file actually missing
            local = thumbs_dir / f"{memo.id}.jpg"
            if local.exists():
                skipped += 1
                continue

        real_path = resolve_memo_path(memo.file_path) if memo.file_path else None
        if not real_path or not Path(real_path).exists():
            failed += 1
            continue

        target = thumbs_dir / f"{memo.id}.jpg"
        ok = await extract_video_thumbnail(real_path, target)
        if ok:
            memo.thumbnail_path = f"/api/files/thumb/{memo.id}.jpg"
            memo.updated_at = datetime.utcnow()
            processed += 1
        else:
            failed += 1

    await db.commit()
    return {"processed": processed, "skipped_existing": skipped, "failed": failed, "total_videos": len(rows)}


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _empty_dir(path: Path) -> None:
    if not path.exists():
        return
    for child in path.iterdir():
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except OSError:
            pass


@router.post("/reindex")
async def reindex_embeddings():
    """Rebuild the vector index from scratch: re-embed every live memo with the
    current chunking + embedding model (incl. nomic task prefixes), and purge
    chunks belonging to deleted/missing memos ("ghosts").

    Run this after changing EMBED_MODEL or upgrading past 2.2.x — embeddings
    written by a different model live in a different vector space and make
    retrieval garbage. Idempotent; safe to run anytime. Ollama must be up."""
    from sqlalchemy import select
    from backend.core.embedder import embed_memo
    from backend.core.ollama_client import ollama_client
    from backend.db.chroma_client import get_collection
    from backend.db.database import AsyncSessionLocal
    import asyncio as _asyncio

    if not await ollama_client.health_check():
        raise HTTPException(status_code=503, detail="Ollama is not reachable — start it first.")

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Memo).where(Memo.is_deleted == False)  # noqa: E712
            )
        ).scalars().all()
        live_ids = {m.id for m in rows}

        reindexed = 0
        chunks_written = 0
        failed = 0
        for memo in rows:
            text = memo.content_text
            if not text or not text.strip():
                continue
            if memo.notes:
                text += f"\n\n--- Notes ---\n{memo.notes}"
            try:
                ids = await embed_memo(
                    memo_id=memo.id,
                    text=text,
                    metadata={
                        "workspace_id": memo.workspace_id,
                        "type": memo.type,
                        "title": memo.title,
                        "source_domain": memo.source_domain or "",
                    },
                )
                memo.embedding_ids = ids
                memo.is_processed = True
                reindexed += 1
                chunks_written += len(ids)
            except Exception as e:
                failed += 1
                print(f"Reindex failed for {memo.id}: {e}")
        await db.commit()

    # Purge ghosts — chunks whose memo no longer exists or is soft-deleted.
    collection = get_collection()
    existing = await _asyncio.to_thread(collection.get, include=["metadatas"])
    ghost_ids = [
        cid
        for cid, md in zip(existing["ids"], existing["metadatas"])
        if md.get("memo_id") not in live_ids
    ]
    if ghost_ids:
        await _asyncio.to_thread(collection.delete, ids=ghost_ids)

    return {
        "reindexed_memos": reindexed,
        "chunks_written": chunks_written,
        "failed": failed,
        "ghost_chunks_purged": len(ghost_ids),
    }


@router.post("/localize")
async def localize_content():
    """Backfill: download remote images in every memo's extracted content and
    rewrite them to local copies, so saved memos survive source deletion."""
    from backend.core.localizer import localize_all

    return await localize_all()


@router.post("/clear-cache")
async def clear_cache():
    """Delete locally-cached thumbnail previews. Safe — they re-cache on next
    fetch / re-ingest."""
    thumbs = Path(settings.FILES_DIR) / "thumbs"
    freed = _dir_size(thumbs)
    _empty_dir(thumbs)
    return {"ok": True, "freed_bytes": freed}


class ResetRequest(BaseModel):
    confirm: bool = False


@router.post("/reset")
async def reset_workspace(body: ResetRequest, db: AsyncSession = Depends(get_db)):
    """Wipe all memos, collections, tags, chats and files. Irreversible.
    Requires an explicit confirm flag."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Confirmation required")

    # DB rows — associations first, then entities.
    await db.execute(memo_tags.delete())
    await db.execute(memo_collections.delete())
    for model in (Message, ChatSession, Tag, Collection, Memo):
        await db.execute(delete(model))
    await db.commit()

    # Files + thumbnail cache.
    _empty_dir(Path(settings.FILES_DIR))

    # Vector store — drop the Chroma collection if present.
    try:
        from backend.db.chroma_client import chroma_client

        try:
            chroma_client.delete_collection(settings.CHROMA_COLLECTION)
        except Exception:
            pass
    except Exception:
        pass

    return {"ok": True}
