"""Memo service — all memo DB operations go through here."""

import uuid
from datetime import datetime

from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload

from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo, Collection, Tag
from backend.services.base import BaseService


class MemoService(BaseService[Memo]):
    """Service for Memo CRUD and queries."""

    model = Memo
    default_relations = [Memo.collections, Memo.tags]

    async def list_by_workspace(
        self,
        workspace_id: str,
        *,
        memo_type: str | None = None,
        collection_id: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ):
        """List memos with filtering. Returns (items, total)."""
        session = await self._get_session()

        query = (
            select(Memo)
            .options(selectinload(Memo.collections), selectinload(Memo.tags))
            .where(Memo.workspace_id == workspace_id)
        )

        if memo_type and memo_type != "all":
            query = query.where(Memo.type == memo_type)

        if collection_id:
            from backend.db.models import memo_collections
            query = query.join(memo_collections).where(
                memo_collections.c.collection_id == collection_id
            )

        if search:
            query = query.where(
                Memo.title.ilike(f"%{search}%") | Memo.content_text.ilike(f"%{search}%")
            )

        # Count total before pagination
        count_query = select(func.count()).select_from(query.subquery())
        total = (await session.execute(count_query)).scalar() or 0

        # Order + paginate
        query = query.order_by(desc(Memo.sort_order), desc(Memo.created_at))
        query = query.offset(offset).limit(limit)

        result = await session.execute(query)
        items = result.scalars().all()
        return items, total

    async def create_memo(
        self,
        *,
        workspace_id: str,
        type: str,
        title: str,
        description: str | None = None,
        content_text: str | None = None,
        content_raw: str | None = None,
        source_url: str | None = None,
        source_domain: str | None = None,
        source_favicon: str | None = None,
        thumbnail_path: str | None = None,
        file_path: str | None = None,
        notes: str | None = None,
        collection_ids: list[str] | None = None,
        tags: list[str] | None = None,
    ) -> Memo:
        """Create a new memo with optional collections and tags."""
        session = await self._get_session()

        max_order_result = await session.execute(
            select(func.max(Memo.sort_order)).where(Memo.workspace_id == workspace_id)
        )
        max_order = max_order_result.scalar() or 0

        now = datetime.utcnow()
        memo = Memo(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            type=type,
            title=title,
            description=description,
            content_text=content_text,
            content_raw=content_raw,
            source_url=source_url,
            source_domain=source_domain,
            source_favicon=source_favicon,
            thumbnail_path=thumbnail_path,
            file_path=file_path,
            notes=notes,
            sort_order=max_order + 1,
            created_at=now,
            updated_at=now,
            recency_at=now,
        )

        # Add collections
        if collection_ids:
            for cid in collection_ids:
                col = await session.get(Collection, cid)
                if col:
                    memo.collections.append(col)

        # Add tags
        if tags:
            for tag_name in tags:
                result = await session.execute(select(Tag).where(Tag.name == tag_name))
                tag = result.scalar_one_or_none()
                if not tag:
                    tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                    session.add(tag)
                memo.tags.append(tag)

        session.add(memo)
        await session.commit()
        await session.refresh(memo)
        return memo

    async def update_memo(
        self,
        memo_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        content_text: str | None = None,
        content_raw: str | None = None,
        source_url: str | None = None,
        notes: str | None = None,
        collection_ids: list[str] | None = None,
        tags: list[str] | None = None,
    ) -> Memo:
        """Update a memo. Handles collections and tags replacement."""
        session = await self._get_session()

        # Load memo with relations
        result = await session.execute(
            select(Memo)
            .options(selectinload(Memo.collections), selectinload(Memo.tags))
            .where(Memo.id == memo_id)
        )
        memo = result.scalar_one_or_none()
        if not memo:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Memo not found")

        changed = []

        # Simple field updates
        for field, value in [
            ("title", title),
            ("description", description),
            ("content_text", content_text),
            ("content_raw", content_raw),
            ("source_url", source_url),
            ("notes", notes),
        ]:
            if value is not None and getattr(memo, field) != value:
                setattr(memo, field, value)
                changed.append(field)

        # Replace collections
        if collection_ids is not None:
            memo.collections = []
            for cid in collection_ids:
                col = await session.get(Collection, cid)
                if col:
                    memo.collections.append(col)
            changed.append("collections")

        # Replace tags
        if tags is not None:
            memo.tags = []
            for tag_name in tags:
                result = await session.execute(select(Tag).where(Tag.name == tag_name))
                tag = result.scalar_one_or_none()
                if not tag:
                    tag = Tag(id=str(uuid.uuid4()), name=tag_name)
                    session.add(tag)
                memo.tags.append(tag)
            changed.append("tags")

        if changed:
            memo.updated_at = datetime.utcnow()
            await session.commit()
            await session.refresh(memo)

        return memo
