"""Spaces API (ADR-020).

A Space is a Workspace with kind='space'. The 'default' workspace is the main
library (kind='library') and is never returned here. Memos and collections carry
workspace_id, so a Space is isolated by a filter, not a separate database.

Delete is the one destructive, unrecoverable action in openMemo: it removes the
Space, its collections, AND all of its memos. The endpoint refuses unless the
caller echoes the exact Space name back, mirroring the typed-sentence gate in the
UI. A Space-scoped export (GET .../export) lets the user back everything up first.
"""
import io
import json
import uuid
import zipfile
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from backend.db.database import get_db
from backend.db.models import (
    Workspace, Memo, Collection, ChatSession,
    memo_collections, memo_tags,
)
from backend.api.export import memo_to_markdown
from backend.core.security import sanitize_workspace_id

router = APIRouter(prefix="/api/spaces", tags=["spaces"])

# The library workspace id is reserved and never a Space (CLAUDE.md).
LIBRARY_ID = "default"


class SpaceCreate(BaseModel):
    name: str
    emoji: Optional[str] = "🗂️"
    icon: Optional[str] = None
    color: Optional[str] = "#6366F1"
    description: Optional[str] = None


class SpaceUpdate(BaseModel):
    name: Optional[str] = None
    emoji: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    pinned: Optional[bool] = None
    sort_order: Optional[int] = None


class SpaceDelete(BaseModel):
    # Must equal the Space's exact name, or the delete is refused (server-side
    # mirror of the typed-sentence confirmation the UI enforces).
    confirm_name: str


async def _space_counts(db: AsyncSession, space_id: str) -> dict:
    """Live memo + collection counts for a Space (drives the delete warning)."""
    memo_count = (
        await db.execute(
            select(func.count(Memo.id)).where(
                Memo.workspace_id == space_id,
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E711,E712
            )
        )
    ).scalar_one()
    coll_count = (
        await db.execute(
            select(func.count(Collection.id)).where(Collection.workspace_id == space_id)
        )
    ).scalar_one()
    return {"memos": memo_count, "collections": coll_count}


def _space_dict(w: Workspace, counts: Optional[dict] = None) -> dict:
    d = {
        "id": w.id,
        "name": w.name,
        "emoji": w.emoji,
        "icon": w.icon,
        "color": w.color,
        "description": w.description,
        "pinned": bool(w.pinned),
        "sort_order": w.sort_order or 0,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }
    if counts is not None:
        d["counts"] = counts
    return d


@router.get("")
async def list_spaces(db: AsyncSession = Depends(get_db)):
    """List Spaces (workspaces where kind='space'), pinned first."""
    rows = (
        await db.execute(
            select(Workspace)
            .where(Workspace.kind == "space")
            .order_by(Workspace.pinned.desc(), Workspace.sort_order, Workspace.created_at)
        )
    ).scalars().all()
    out = []
    for w in rows:
        out.append(_space_dict(w, await _space_counts(db, w.id)))
    return out


@router.post("")
async def create_space(data: SpaceCreate, db: AsyncSession = Depends(get_db)):
    """Create a Space. Reuses the single owner (local single-user mode)."""
    from backend.db.models import User
    owner = (await db.execute(select(User).limit(1))).scalar_one_or_none()
    space = Workspace(
        id=str(uuid.uuid4()),
        name=data.name.strip() or "Untitled Space",
        owner_id=owner.id if owner else None,
        type="personal",
        kind="space",
        emoji=data.emoji,
        icon=data.icon,
        color=data.color,
        description=data.description,
    )
    db.add(space)
    await db.commit()
    return _space_dict(space, {"memos": 0, "collections": 0})


@router.get("/{space_id}")
async def get_space(space_id: str, db: AsyncSession = Depends(get_db)):
    space_id = sanitize_workspace_id(space_id)
    space = await db.get(Workspace, space_id)
    if not space or space.kind != "space":
        raise HTTPException(status_code=404, detail="Space not found")
    return _space_dict(space, await _space_counts(db, space.id))


@router.put("/{space_id}")
async def update_space(space_id: str, data: SpaceUpdate, db: AsyncSession = Depends(get_db)):
    space_id = sanitize_workspace_id(space_id)
    space = await db.get(Workspace, space_id)
    if not space or space.kind != "space":
        raise HTTPException(status_code=404, detail="Space not found")
    for field in ("name", "emoji", "icon", "color", "description", "pinned", "sort_order"):
        val = getattr(data, field)
        if val is not None:
            setattr(space, field, val)
    await db.commit()
    return _space_dict(space, await _space_counts(db, space.id))


@router.get("/{space_id}/export")
async def export_space(space_id: str, db: AsyncSession = Depends(get_db)):
    """Zip every memo in the Space as Markdown, plus a collections.json manifest.

    This is the pre-delete backup. It is a normal GET, so the user can grab it
    any time, not only before deleting.
    """
    space_id = sanitize_workspace_id(space_id)
    space = await db.get(Workspace, space_id)
    if not space or space.kind != "space":
        raise HTTPException(status_code=404, detail="Space not found")

    memos = (
        await db.execute(
            select(Memo).where(
                Memo.workspace_id == space_id,
                (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E711,E712
            )
        )
    ).scalars().all()
    collections = (
        await db.execute(select(Collection).where(Collection.workspace_id == space_id))
    ).scalars().all()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "space": {"id": space.id, "name": space.name, "description": space.description},
            "exported_at": datetime.utcnow().isoformat(),
            "collections": [
                {"id": c.id, "name": c.name, "emoji": c.emoji, "description": c.description}
                for c in collections
            ],
        }
        zf.writestr("space.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        used = set()
        for memo in memos:
            base = (memo.title or "untitled")[:50].replace("/", "-").replace("\\", "-")
            name = f"{base}.md"
            i = 1
            while name in used:
                name = f"{base} ({i}).md"
                i += 1
            used.add(name)
            zf.writestr(f"memos/{name}", memo_to_markdown(memo))

    buffer.seek(0)
    safe = (space.name or "space")[:40].replace("/", "-").replace("\\", "-")
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="openmemo_space_{safe}_{datetime.now().strftime("%Y%m%d")}.zip"',
        },
    )


@router.post("/{space_id}/delete")
async def delete_space(space_id: str, data: SpaceDelete, db: AsyncSession = Depends(get_db)):
    """Destructively delete a Space: its collections AND all of its memos.

    Unrecoverable. Refused unless `confirm_name` matches the Space's exact name.
    Embeddings are purged per memo so the vector index keeps no ghosts.
    """
    space_id = sanitize_workspace_id(space_id)
    space = await db.get(Workspace, space_id)
    if not space or space.kind != "space":
        raise HTTPException(status_code=404, detail="Space not found")
    if (data.confirm_name or "").strip() != (space.name or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Confirmation does not match the Space name. Delete refused.",
        )

    memo_ids = [
        r[0] for r in (
            await db.execute(select(Memo.id).where(Memo.workspace_id == space_id))
        ).all()
    ]

    # Purge embeddings first (non-fatal; a reindex sweeps stragglers).
    if memo_ids:
        try:
            from backend.core.embedder import delete_memo_embeddings
            for mid in memo_ids:
                await delete_memo_embeddings(mid)
        except Exception as e:
            print(f"Space delete: embedding purge warning: {e}")

    # Join rows first (no cascade configured on the association tables).
    if memo_ids:
        await db.execute(sa_delete(memo_collections).where(memo_collections.c.memo_id.in_(memo_ids)))
        await db.execute(sa_delete(memo_tags).where(memo_tags.c.memo_id.in_(memo_ids)))
    await db.execute(sa_delete(ChatSession).where(ChatSession.workspace_id == space_id))
    await db.execute(sa_delete(Memo).where(Memo.workspace_id == space_id))
    await db.execute(sa_delete(Collection).where(Collection.workspace_id == space_id))
    await db.delete(space)
    await db.commit()
    return {"status": "deleted", "removed": {"memos": len(memo_ids)}}
