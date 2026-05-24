"""Memo CRUD API endpoints."""
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from backend.db.database import get_db
from backend.db.models import Memo, Collection, Tag, memo_collections, memo_tags
from backend.core.security import sanitize_workspace_id
from backend.core.file_paths import resolve_memo_path

router = APIRouter(prefix="/api/memos", tags=["memos"])


# --- Schemas ---

class MemoCreate(BaseModel):
    type: str
    title: str
    description: Optional[str] = None
    content_text: Optional[str] = None
    content_raw: Optional[str] = None
    source_url: Optional[str] = None
    source_domain: Optional[str] = None
    source_favicon: Optional[str] = None
    thumbnail_path: Optional[str] = None
    workspace_id: Optional[str] = None
    collection_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class MemoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content_text: Optional[str] = None
    content_raw: Optional[str] = None
    source_url: Optional[str] = None
    notes: Optional[str] = None
    collection_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None


class MemoResponse(BaseModel):
    id: str
    type: str
    title: str
    description: Optional[str]
    content_text: Optional[str]
    source_url: Optional[str]
    source_domain: Optional[str]
    source_favicon: Optional[str]
    thumbnail_path: Optional[str]
    ai_summary: Optional[str]
    is_processed: bool
    created_at: datetime
    updated_at: datetime
    collections: list[dict] = []
    tags: list[str] = []

    class Config:
        from_attributes = True


# --- Routes ---

_SORT_MODES = {"recent", "oldest", "title", "custom"}


def _apply_sort(query, sort: str):
    """Apply ORDER BY based on the requested sort mode.

    - recent (default): newest first by created_at. Manual sort_order is
      intentionally ignored so freshly added memos always land on top.
    - oldest: oldest first.
    - title: alphabetical, case-insensitive.
    - custom: respects manual drag-to-reorder (sort_order desc), then
      created_at as a stable tiebreaker.
    """
    if sort == "oldest":
        return query.order_by(asc(Memo.created_at))
    if sort == "title":
        return query.order_by(func.lower(Memo.title).asc())
    if sort == "custom":
        return query.order_by(desc(Memo.sort_order), desc(Memo.created_at))
    # recent / unknown -> default
    return query.order_by(desc(Memo.created_at))


@router.get("")
async def list_memos(
    workspace_id: Optional[str] = None,
    type: Optional[str] = None,
    collection_id: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "recent",
    offset: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    if workspace_id:
        workspace_id = sanitize_workspace_id(workspace_id)
    if sort not in _SORT_MODES:
        sort = "recent"
    """List memos with filtering and pagination."""
    query = select(Memo).options(
        selectinload(Memo.collections),
        selectinload(Memo.tags),
    )

    if workspace_id:
        query = query.where(Memo.workspace_id == workspace_id)
    if type and type != "all":
        query = query.where(Memo.type == type)
    if collection_id:
        query = query.join(memo_collections).where(
            memo_collections.c.collection_id == collection_id
        )
    if search:
        query = query.where(
            Memo.title.ilike(f"%{search}%") | Memo.content_text.ilike(f"%{search}%")
        )

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    # Fetch with pagination
    query = _apply_sort(query, sort).offset(offset).limit(limit)
    result = await db.execute(query)
    memos = result.scalars().all()
    
    return {
        "items": [
            {
                "id": m.id,
                "type": m.type,
                "title": m.title,
                "description": m.description,
                "content_text": (m.content_text[:400] if m.content_text else None),
                "source_url": m.source_url,
                "source_domain": m.source_domain,
                "source_favicon": m.source_favicon,
                "thumbnail_path": m.thumbnail_path,
                "file_path": m.file_path,
                "ai_summary": m.ai_summary,
                "notes": m.notes,
                "sort_order": m.sort_order,
                "is_processed": m.is_processed,
                "created_at": m.created_at.isoformat(),
                "updated_at": m.updated_at.isoformat(),
                "collections": [{"id": c.id, "name": c.name, "color": c.color} for c in m.collections],
                "tags": [t.name for t in m.tags],
            }
            for m in memos
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/{memo_id}")
async def get_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single memo by ID."""
    query = select(Memo).options(
        selectinload(Memo.collections),
        selectinload(Memo.tags),
    ).where(Memo.id == memo_id)
    
    result = await db.execute(query)
    memo = result.scalar_one_or_none()
    
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    return {
        "id": memo.id,
        "type": memo.type,
        "title": memo.title,
        "description": memo.description,
        "content_text": memo.content_text,
        "content_raw": memo.content_raw,
        "notes": memo.notes,
        "source_url": memo.source_url,
        "source_domain": memo.source_domain,
        "source_favicon": memo.source_favicon,
        "file_path": memo.file_path,
        "thumbnail_path": memo.thumbnail_path,
        "ai_summary": memo.ai_summary,
        "notes": memo.notes,
        "sort_order": memo.sort_order,
        "is_processed": memo.is_processed,
        "created_at": memo.created_at.isoformat(),
        "updated_at": memo.updated_at.isoformat(),
        "collections": [{"id": c.id, "name": c.name, "color": c.color} for c in memo.collections],
        "tags": [t.name for t in memo.tags],
    }


@router.get("/{memo_id}/file")
async def get_memo_file(
    memo_id: str,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Serve the original uploaded file for a memo.

    Inline by default (used for image rendering); pass ?download=1 to force a
    download with the original filename.
    """
    memo = (
        await db.execute(select(Memo).where(Memo.id == memo_id))
    ).scalar_one_or_none()
    if not memo or not memo.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    p = resolve_memo_path(memo.file_path)
    if p is None:
        raise HTTPException(status_code=404, detail="File not found")

    media_type = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    if download:
        filename = (memo.title or p.name).replace('"', "")
        return FileResponse(str(p), media_type=media_type, filename=filename)
    return FileResponse(str(p), media_type=media_type)


@router.post("")
async def create_memo(data: MemoCreate, db: AsyncSession = Depends(get_db)):
    """Create a new memo."""
    memo = Memo(
        id=str(uuid.uuid4()),
        workspace_id=sanitize_workspace_id(data.workspace_id),
        type=data.type,
        title=data.title,
        description=data.description,
        content_text=data.content_text,
        content_raw=data.content_raw,
        source_url=data.source_url,
        source_domain=data.source_domain,
        source_favicon=data.source_favicon,
        thumbnail_path=data.thumbnail_path,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    
    # Add to collections
    if data.collection_ids:
        for cid in data.collection_ids:
            col = await db.get(Collection, cid)
            if col:
                memo.collections.append(col)
    
    # Add tags
    if data.tags:
        for tag_name in data.tags:
            # Get or create tag
            result = await db.execute(select(Tag).where(Tag.name == tag_name))
            tag = result.scalar_one_or_none()
            if not tag:
                tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                db.add(tag)
            memo.tags.append(tag)
    
    db.add(memo)
    await db.commit()
    await db.refresh(memo)
    
    return {"id": memo.id, "status": "created"}


@router.put("/{memo_id}")
async def update_memo(memo_id: str, data: MemoUpdate, db: AsyncSession = Depends(get_db)):
    """Update an existing memo."""
    result = await db.execute(
        select(Memo)
        .options(selectinload(Memo.collections), selectinload(Memo.tags))
        .where(Memo.id == memo_id)
    )
    memo = result.scalar_one_or_none()
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    if data.title is not None:
        memo.title = data.title
    if data.description is not None:
        memo.description = data.description
    if data.content_text is not None:
        memo.content_text = data.content_text
    if data.content_raw is not None:
        memo.content_raw = data.content_raw
    if data.source_url is not None:
        memo.source_url = data.source_url
    if data.notes is not None:
        memo.notes = data.notes
    
    # Trigger re-embedding if content changed
    content_changed = data.content_text is not None or data.notes is not None
    
    # Update collections
    if data.collection_ids is not None:
        memo.collections = []
        for cid in data.collection_ids:
            col = await db.get(Collection, cid)
            if col:
                memo.collections.append(col)
    
    # Update tags
    if data.tags is not None:
        memo.tags = []
        for tag_name in data.tags:
            result = await db.execute(select(Tag).where(Tag.name == tag_name))
            tag = result.scalar_one_or_none()
            if not tag:
                tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                db.add(tag)
            memo.tags.append(tag)
    
    memo.updated_at = datetime.utcnow()
    await db.commit()
    
    # Re-embed in background if content changed
    if content_changed:
        from backend.api.ingest import process_memo
        import asyncio
        asyncio.create_task(process_memo(memo_id))
    
    return {"id": memo.id, "status": "updated"}


class SortUpdate(BaseModel):
    sort_order: int


@router.put("/{memo_id}/sort")
async def update_memo_sort(memo_id: str, body: SortUpdate, db: AsyncSession = Depends(get_db)):
    """Update a memo's sort order."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    memo.sort_order = body.sort_order
    memo.updated_at = datetime.utcnow()
    await db.commit()
    return {"id": memo.id, "sort_order": memo.sort_order, "status": "updated"}


@router.delete("/{memo_id}")
async def delete_memo(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a memo."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    # Delete embeddings from ChromaDB
    from backend.core.embedder import delete_memo_embeddings
    await delete_memo_embeddings(memo_id)
    
    await db.delete(memo)
    await db.commit()
    
    return {"status": "deleted"}


@router.post("/{memo_id}/summary")
async def generate_memo_summary(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Generate AI summary for a memo."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    if not memo.content_text:
        raise HTTPException(status_code=400, detail="Memo has no content to summarize")
    
    from backend.core.rag import generate_summary
    summary = await generate_summary(memo.content_text)
    
    memo.ai_summary = summary
    memo.updated_at = datetime.utcnow()
    await db.commit()
    
    return {"id": memo.id, "summary": summary}


@router.get("/{memo_id}/related")
async def get_related_memos(memo_id: str, db: AsyncSession = Depends(get_db)):
    """Get semantically related memos."""
    memo = await db.get(Memo, memo_id)
    if not memo:
        raise HTTPException(status_code=404, detail="Memo not found")
    
    from backend.core.embedder import search_similar
    
    # Use memo title + description as query
    query_text = f"{memo.title} {memo.description or ''}"
    results = await search_similar(query=query_text, n_results=5)
    
    # Filter out self and deduplicate by memo_id
    seen = set()
    related = []
    for r in results:
        mid = r["metadata"].get("memo_id")
        if mid and mid != memo_id and mid not in seen:
            seen.add(mid)
            related.append(mid)
    
    # Fetch memo details
    if related:
        query = select(Memo).where(Memo.id.in_(related[:4]))
        result = await db.execute(query)
        memos = result.scalars().all()
        return [
            {
                "id": m.id,
                "type": m.type,
                "title": m.title,
                "thumbnail_path": m.thumbnail_path,
                "source_domain": m.source_domain,
            }
            for m in memos
        ]
    
    return []
