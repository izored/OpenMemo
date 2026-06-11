"""Collections CRUD API."""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.db.database import get_db
from backend.db.models import Collection, memo_collections
from backend.core.security import sanitize_workspace_id

router = APIRouter(prefix="/api/collections", tags=["collections"])


class CollectionCreate(BaseModel):
    name: str
    emoji: Optional[str] = "📁"
    description: Optional[str] = None
    color: Optional[str] = "#D97706"
    # 'standard' (default) or 'playlist' (music playlist, ADR-015).
    kind: Optional[str] = "standard"
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
    if workspace_id:
        query = query.where(Collection.workspace_id == sanitize_workspace_id(workspace_id))

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
    
    await db.delete(collection)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{collection_id}/memos/{memo_id}")
async def add_memo_to_collection(
    collection_id: str,
    memo_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Add a memo to a collection."""
    from sqlalchemy import insert
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
