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
    MemoCast,
    memo_collections,
    memo_tags,
)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


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
    for model in (Message, ChatSession, MemoCast, Tag, Collection, Memo):
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
