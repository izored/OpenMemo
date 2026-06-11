"""Music page API (Music Experience V2, ADR-014).

Read-side aggregation for the Music page: playlists (playlist-kind
collections) with track counts, cover collages, and live download progress.
Progress is derived from the per-memo localize_status written by the playlist
downloader — no job table, restart-safe.

Tracks themselves are served by the existing /api/memos list
(type=audio&audio_kind=music, optionally collection_id=<playlist>).
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import Collection, Memo, memo_collections

router = APIRouter(prefix="/api/music", tags=["music"])


@router.get("/playlists")
async def list_playlists(db: AsyncSession = Depends(get_db)):
    """All music playlists with track count, up to 4 covers, and progress."""
    playlists = (
        await db.execute(
            select(Collection)
            .where(Collection.kind == "playlist")
            .order_by(desc(Collection.created_at))
        )
    ).scalars().all()
    if not playlists:
        return []

    ids = [p.id for p in playlists]
    # One pass over every playlist's tracks (playlists are ≤100 tracks each);
    # counts, covers and progress aggregate in Python. Ordered by the recency
    # stagger so covers + progress follow playlist order.
    rows = (
        await db.execute(
            select(
                memo_collections.c.collection_id,
                Memo.thumbnail_path,
                Memo.localize_status,
                Memo.file_path,
            )
            .join(Memo, Memo.id == memo_collections.c.memo_id)
            .where(memo_collections.c.collection_id.in_(ids))
            .where((Memo.is_deleted == False) | (Memo.is_deleted == None))  # noqa: E712
            .order_by(desc(Memo.recency_at), desc(Memo.created_at))
        )
    ).all()

    by_playlist: dict[str, dict] = {
        pid: {"total": 0, "done": 0, "error": 0, "covers": []} for pid in ids
    }
    for cid, thumb, status, file_path in rows:
        agg = by_playlist[cid]
        agg["total"] += 1
        if file_path or status == "done":
            agg["done"] += 1
        elif status == "error":
            agg["error"] += 1
        if thumb and len(agg["covers"]) < 4:
            agg["covers"].append(thumb)

    return [
        {
            "id": p.id,
            "name": p.name,
            "source_url": p.source_url,
            "created_at": p.created_at.isoformat(),
            "track_count": by_playlist[p.id]["total"],
            "covers": by_playlist[p.id]["covers"],
            "progress": {
                "total": by_playlist[p.id]["total"],
                "done": by_playlist[p.id]["done"],
                "error": by_playlist[p.id]["error"],
            },
        }
        for p in playlists
    ]
