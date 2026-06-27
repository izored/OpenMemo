"""Hybrid search API - semantic + full-text (FTS5)."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy import select, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db, AsyncSessionLocal
from backend.db.models import Memo
from backend.db.fts5 import search_fts5
from backend.core.embedder import search_similar
from backend.core.security import sanitize_workspace_id

router = APIRouter(prefix="/api/search", tags=["search"])


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("")
async def hybrid_search(
    q: str,
    workspace_id: str = "default",
    limit: int = 20,
):
    workspace_id = sanitize_workspace_id(workspace_id)
    """Hybrid search: full-text + semantic with reciprocal rank fusion."""
    results = []
    existing_ids = set()
    
    # --- Semantic search ---
    try:
        semantic_results = await search_similar(
            query=q,
            workspace_id=workspace_id,
            n_results=limit,
        )
        
        memo_ids = list(set(
            r["metadata"]["memo_id"] for r in semantic_results
            if r["metadata"].get("memo_id")
        ))
        
        async with AsyncSessionLocal() as db:
            if memo_ids:
                result = await db.execute(
                    select(Memo).where(Memo.id.in_(memo_ids), Memo.is_deleted == False)  # noqa: E712
                )
                memos = result.scalars().all()
                
                for memo in memos:
                    if memo.id not in existing_ids:
                        existing_ids.add(memo.id)
                        results.append({
                            "id": memo.id,
                            "type": memo.type,
                            "title": memo.title,
                            "description": memo.description,
                            "source_domain": memo.source_domain,
                            "thumbnail_path": memo.thumbnail_path,
                            "created_at": memo.created_at.isoformat(),
                            "match_type": "semantic",
                        })
    except Exception as e:
        logger.warning("Semantic search error: %s", e)
    
    # --- Full-text search (FTS5 preferred, ilike fallback) ---
    try:
        fts_results = await search_fts5(q, workspace_id, limit)
        
        if fts_results:
            fts_ids = [r["memo_id"] for r in fts_results]
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Memo).where(Memo.id.in_(fts_ids), Memo.is_deleted == False)  # noqa: E712
                )
                memos = result.scalars().all()
                
                for memo in memos:
                    if memo.id not in existing_ids:
                        existing_ids.add(memo.id)
                        results.append({
                            "id": memo.id,
                            "type": memo.type,
                            "title": memo.title,
                            "description": memo.description,
                            "source_domain": memo.source_domain,
                            "thumbnail_path": memo.thumbnail_path,
                            "created_at": memo.created_at.isoformat(),
                            "match_type": "fulltext",
                        })
        else:
            # Fallback to ilike if FTS5 not available
            async with AsyncSessionLocal() as db:
                ft_result = await db.execute(
                    select(Memo).where(
                        or_(
                            Memo.title.ilike(f"%{_escape_like(q)}%", escape="\\"),
                            Memo.content_text.ilike(f"%{_escape_like(q)}%", escape="\\"),
                        )
                    ).where(Memo.workspace_id == workspace_id, Memo.is_deleted == False).limit(limit)  # noqa: E712
                )
                ft_memos = ft_result.scalars().all()
                
                for memo in ft_memos:
                    if memo.id not in existing_ids:
                        existing_ids.add(memo.id)
                        results.append({
                            "id": memo.id,
                            "type": memo.type,
                            "title": memo.title,
                            "description": memo.description,
                            "source_domain": memo.source_domain,
                            "thumbnail_path": memo.thumbnail_path,
                            "created_at": memo.created_at.isoformat(),
                            "match_type": "fulltext",
                        })
    except Exception as e:
        logger.warning("Full-text search error: %s", e)
    
    return {"results": results, "total": len(results)}
