"""Collections CRUD API."""
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.config import settings
from backend.db.database import get_db
from backend.db.models import Collection, memo_collections
from backend.core.security import sanitize_workspace_id

router = APIRouter(prefix="/api/collections", tags=["collections"])

# Custom playlist/album covers live next to the DB, one per collection:
# DATA_DIR/playlist_covers/<id>.<ext> (mirrors the Space cover convention).
_COVER_DIR = Path(settings.DATA_DIR) / "playlist_covers"
_COVER_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "avif"}
_COVER_MAX = 12 * 1024 * 1024  # 12 MB


def _cover_path(collection_id: str, ext: str) -> Path:
    return _COVER_DIR / f"{collection_id}.{ext}"


def collection_cover_url(c: Collection) -> Optional[str]:
    """Cache-busted URL for a collection's hand-set cover, or None."""
    if not getattr(c, "cover_ext", None):
        return None
    p = _cover_path(c.id, c.cover_ext)
    try:
        v = int(p.stat().st_mtime)
    except OSError:
        v = 0
    return f"/api/collections/{c.id}/cover?v={v}"


class CollectionCreate(BaseModel):
    name: str
    emoji: Optional[str] = "📁"
    description: Optional[str] = None
    color: Optional[str] = "#D97706"
    # 'standard' (default) or 'playlist' (music playlist, ADR-015).
    kind: Optional[str] = "standard"
    # Playlist sub-kind: 'album' | 'playlist' | 'hero' (custom pinned hero card).
    music_kind: Optional[str] = None
    # Pin straight to the Music hero rail on create (custom hero cards do this).
    pinned: Optional[bool] = None
    # Playlists: the source playlist URL they were ingested from.
    source_url: Optional[str] = None
    workspace_id: Optional[str] = None


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    emoji: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None
    sort_order: Optional[int] = None


@router.get("")
async def list_collections(
    workspace_id: Optional[str] = None,
    kind: str = "standard",
    db: AsyncSession = Depends(get_db),
):
    """List collections, filtered by kind (ADR-015).

    Default 'standard' keeps playlists out of the sidebar, the collections
    page, and every collection picker with no frontend changes. Pass
    kind=playlist for the Music page, kind=all for everything. NULL kind
    (rows predating the column) counts as standard.
    """
    query = select(Collection).order_by(Collection.pinned.desc(), Collection.sort_order)
    if kind == "standard":
        query = query.where(
            (Collection.kind == "standard") | (Collection.kind == None)  # noqa: E711
        )
    elif kind != "all":
        query = query.where(Collection.kind == kind)
    # Spaces isolation (ADR-020): a missing workspace_id means the main library,
    # not "all workspaces". A Space passes its id to get only its collections.
    ws = sanitize_workspace_id(workspace_id) if workspace_id else "default"
    query = query.where(Collection.workspace_id == ws)

    result = await db.execute(query)
    collections = result.scalars().all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "emoji": c.emoji,
            "description": c.description,
            "color": c.color,
            "kind": c.kind or "standard",
            "source_url": c.source_url,
            "cover_url": collection_cover_url(c),
            "pinned": c.pinned,
            "sort_order": c.sort_order,
            "created_at": c.created_at.isoformat(),
        }
        for c in collections
    ]


@router.post("")
async def create_collection(data: CollectionCreate, db: AsyncSession = Depends(get_db)):
    """Create a new collection."""
    collection = Collection(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        name=data.name,
        emoji=data.emoji,
        description=data.description,
        color=data.color,
        kind=data.kind if data.kind in ("standard", "playlist") else "standard",
        music_kind=data.music_kind if data.music_kind in ("album", "playlist", "hero") else None,
        pinned=bool(data.pinned),
        source_url=data.source_url,
    )
    db.add(collection)
    await db.commit()
    return {"id": collection.id, "name": collection.name}


@router.put("/{collection_id}")
async def update_collection(
    collection_id: str,
    data: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a collection."""
    collection = await db.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    if data.name is not None:
        collection.name = data.name
    if data.emoji is not None:
        collection.emoji = data.emoji
    if data.description is not None:
        collection.description = data.description
    if data.color is not None:
        collection.color = data.color
    if data.pinned is not None:
        collection.pinned = data.pinned
    if data.sort_order is not None:
        collection.sort_order = data.sort_order
    
    await db.commit()
    return {"id": collection.id, "status": "updated"}


@router.delete("/{collection_id}")
async def delete_collection(collection_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a collection (memos are not deleted)."""
    collection = await db.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # Drop any hand-set cover file so it doesn't orphan on disk.
    if collection.cover_ext:
        _cover_path(collection_id, collection.cover_ext).unlink(missing_ok=True)
    await db.delete(collection)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{collection_id}/cover")
async def upload_cover(
    collection_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Set a custom cover image for a playlist/album (already cropped client-side)."""
    collection = await db.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    ext = (Path(file.filename or "").suffix.lstrip(".") or "").lower()
    if ext == "jpe":
        ext = "jpg"
    if ext not in _COVER_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported image type '.{ext}'. Use JPG, PNG, WebP, GIF, or AVIF.")
    raw = await file.read()
    if len(raw) > _COVER_MAX:
        raise HTTPException(status_code=400, detail="Cover image over 12 MB.")

    _COVER_DIR.mkdir(parents=True, exist_ok=True)
    # Drop any previous cover (extension may differ) before writing the new one.
    if collection.cover_ext and collection.cover_ext != ext:
        _cover_path(collection_id, collection.cover_ext).unlink(missing_ok=True)
    _cover_path(collection_id, ext).write_bytes(raw)
    collection.cover_ext = ext
    await db.commit()
    return {"id": collection.id, "cover_url": collection_cover_url(collection)}


@router.get("/{collection_id}/cover")
async def read_cover(collection_id: str, db: AsyncSession = Depends(get_db)):
    collection = await db.get(Collection, collection_id)
    if not collection or not collection.cover_ext:
        raise HTTPException(status_code=404, detail="No cover set.")
    p = _cover_path(collection_id, collection.cover_ext)
    if not p.exists():
        raise HTTPException(status_code=404, detail="No cover set.")
    return FileResponse(p)


@router.delete("/{collection_id}/cover")
async def delete_cover(collection_id: str, db: AsyncSession = Depends(get_db)):
    """Remove the custom cover, falling back to the track-art collage."""
    collection = await db.get(Collection, collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    if collection.cover_ext:
        _cover_path(collection_id, collection.cover_ext).unlink(missing_ok=True)
        collection.cover_ext = None
        await db.commit()
    return {"id": collection.id, "cover_url": None}


@router.post("/{collection_id}/memos/{memo_id}")
async def add_memo_to_collection(
    collection_id: str,
    memo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Add a memo to a collection. Idempotent — re-adding is a no-op."""
    from sqlalchemy import insert, select as _select
    existing = (
        await db.execute(
            _select(memo_collections.c.memo_id).where(
                memo_collections.c.memo_id == memo_id,
                memo_collections.c.collection_id == collection_id,
            )
        )
    ).first()
    if existing:
        return {"status": "exists"}
    await db.execute(
        insert(memo_collections).values(memo_id=memo_id, collection_id=collection_id)
    )
    await db.commit()
    return {"status": "added"}


@router.delete("/{collection_id}/memos/{memo_id}")
async def remove_memo_from_collection(
    collection_id: str,
    memo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Remove a memo from a collection."""
    from sqlalchemy import delete
    await db.execute(
        delete(memo_collections).where(
            memo_collections.c.memo_id == memo_id,
            memo_collections.c.collection_id == collection_id,
        )
    )
    await db.commit()
    return {"status": "removed"}
