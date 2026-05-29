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
