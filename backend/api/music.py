"""Music page API (Music Experience V2, ADR-015).

Read-side aggregation for the Music page: playlists (playlist-kind
collections) with track counts, cover collages, and live download progress.
Progress is derived from the per-memo localize_status written by the playlist
downloader — no job table, restart-safe.

Tracks themselves are served by the existing /api/memos list
(type=audio&audio_kind=music, optionally collection_id=<playlist>).
"""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import Collection, Memo, memo_collections

router = APIRouter(prefix="/api/music", tags=["music"])


@router.get("/playlists")
async def list_playlists(db: AsyncSession = Depends(get_db)):
    """All music playlists with track count, up to 4 covers, and progress."""
    # Pinned-to-hero first (OPNMMO music hero), newest within each group. The
    # Music page builds its hero rail from the leading pinned run.
    playlists = (
        await db.execute(
            select(Collection)
            .where(Collection.kind == "playlist")
            .order_by(Collection.pinned.desc(), desc(Collection.created_at))
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
        pid: {"total": 0, "done": 0, "error": 0, "pending": 0, "covers": []} for pid in ids
    }
    for cid, thumb, status, file_path in rows:
        agg = by_playlist[cid]
        agg["total"] += 1
        if file_path or status == "done":
            agg["done"] += 1
        elif status == "error":
            agg["error"] += 1
        elif status in ("pending", "processing"):
            # An active download. Remote tracks saved without downloading have
            # no status at all — they are neither done, failed, nor pending.
            agg["pending"] += 1
        if thumb and len(agg["covers"]) < 4:
            agg["covers"].append(thumb)

    # A bulk "Download all" pass is in flight only when the downloader says so.
    # A single track grabbed from its tile also goes pending/processing, but
    # that is not a bulk pass — the Pause control keys off `active`, not pending.
    from backend.api.ingest import playlist_download_active
    from backend.api.collections import collection_cover_url

    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "source_url": p.source_url,
            # NULL predates the column (or a hand-made playlist) → playlist.
            # 'hero' = a custom pinned hero card (image + name, no real tracks).
            "music_kind": p.music_kind or "playlist",
            # A hand-set cover overrides the track-art collage when present.
            "cover_url": collection_cover_url(p),
            # Pinned to the Music hero rail (repurposed Collection.pinned —
            # playlist-kind collections never show in the sidebar).
            "pinned": bool(p.pinned),
            "created_at": p.created_at.isoformat(),
            "track_count": by_playlist[p.id]["total"],
            "covers": by_playlist[p.id]["covers"],
            "progress": {
                "total": by_playlist[p.id]["total"],
                "done": by_playlist[p.id]["done"],
                "error": by_playlist[p.id]["error"],
                "pending": by_playlist[p.id]["pending"],
                "active": playlist_download_active(p.id),
            },
        }
        for p in playlists
    ]


@router.post("/playlists/{playlist_id}/download")
async def download_playlist(
    playlist_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Download every still-remote track of a playlist ("download all").

    Marks each remote track pending, then runs the same sequential playlist
    downloader the ingest path uses. Tracks already local (or mid-download)
    are left alone; failed ones get a fresh attempt.
    """
    playlist = await db.get(Collection, playlist_id)
    if not playlist or (playlist.kind or "standard") != "playlist":
        raise HTTPException(status_code=404, detail="Playlist not found")

    rows = (
        await db.execute(
            select(Memo)
            .join(memo_collections, memo_collections.c.memo_id == Memo.id)
            .where(memo_collections.c.collection_id == playlist_id)
            .where((Memo.is_deleted == False) | (Memo.is_deleted == None))  # noqa: E712
            .where(Memo.file_path == None)  # noqa: E711
            .where(Memo.source_url != None)  # noqa: E711
            .order_by(desc(Memo.recency_at), desc(Memo.created_at))
        )
    ).scalars().all()

    queued: list[str] = []
    for m in rows:
        if m.localize_status == "processing":
            continue  # already being fetched right now
        m.localize_status = "pending"
        m.localize_error = None
        m.updated_at = datetime.utcnow()
        queued.append(m.id)
    await db.commit()

    if queued:
        from backend.api.ingest import clear_playlist_pause, download_playlist_task

        # Starting (or resuming) a download wipes any stale pause request.
        clear_playlist_pause(playlist_id)
        background_tasks.add_task(download_playlist_task, playlist_id, queued)

    return {"id": playlist_id, "queued": len(queued), "status": "processing" if queued else "nothing-to-do"}


@router.post("/playlists/{playlist_id}/download/pause")
async def pause_playlist(playlist_id: str, db: AsyncSession = Depends(get_db)):
    """Pause a bulk "Download all" pass.

    The sequential downloader stops at the next track boundary (it can't abort
    the track mid-fetch), so the one in flight finishes. Every track still
    queued (`pending`, not yet started) resets to remote so its count drops and
    its cloud-download chip comes back. Resume by pressing Download all again.
    """
    playlist = await db.get(Collection, playlist_id)
    if not playlist or (playlist.kind or "standard") != "playlist":
        raise HTTPException(status_code=404, detail="Playlist not found")

    from backend.api.ingest import pause_playlist_download

    pause_playlist_download(playlist_id)

    rows = (
        await db.execute(
            select(Memo)
            .join(memo_collections, memo_collections.c.memo_id == Memo.id)
            .where(memo_collections.c.collection_id == playlist_id)
            .where(Memo.localize_status == "pending")
            .where(Memo.file_path == None)  # noqa: E711
        )
    ).scalars().all()

    reset = 0
    for m in rows:
        m.localize_status = None
        m.localize_error = None
        m.updated_at = datetime.utcnow()
        reset += 1
    await db.commit()

    return {"id": playlist_id, "reset": reset, "status": "paused"}
