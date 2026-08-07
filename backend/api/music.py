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
from backend.core.file_paths import resolve_memo_path
from backend.core.job_handlers import queue_task
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
        pid: {"total": 0, "done": 0, "error": 0, "pending": 0, "missing": 0, "covers": []}
        for pid in ids
    }
    for cid, thumb, status, file_path in rows:
        agg = by_playlist[cid]
        agg["total"] += 1
        # A row can claim a file that is no longer on disk (a wiped/restored
        # files dir, a moved library). It is not downloaded — it only looks it.
        on_disk = bool(file_path) and resolve_memo_path(file_path) is not None
        if status in ("pending", "processing"):
            # An active download. Checked first so a re-download of a track that
            # still has its old file reports as pending, not as already done.
            # Remote tracks saved without downloading have no status at all —
            # they are neither done, failed, pending, nor missing.
            agg["pending"] += 1
        elif file_path and not on_disk:
            agg["missing"] += 1
        elif status == "error":
            agg["error"] += 1
        elif on_disk or status == "done":
            agg["done"] += 1
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
                # Tracks whose file vanished from disk. They look local to the
                # track list (file_path is set) but nothing can play them, so
                # the Music page counts them into its re-download control.
                "missing": by_playlist[p.id]["missing"],
                "active": playlist_download_active(p.id),
            },
        }
        for p in playlists
    ]


@router.post("/playlists/{playlist_id}/download")
async def download_playlist(
    playlist_id: str,
    background_tasks: BackgroundTasks,
    scope: str = "missing",
    db: AsyncSession = Depends(get_db),
):
    """Download a playlist's tracks ("download all" / "re-download everything").

    Marks each selected track pending, then runs the same sequential playlist
    downloader the ingest path uses. Tracks mid-download are left alone; failed
    ones get a fresh attempt.

    `scope`:
      `missing` (default) — everything not playable on this device: never
        downloaded, failed, or claiming a `file_path` whose file is gone (a
        wiped or restored files dir). The stale path is cleared so the track
        shows as remote again while it is re-pulled.
      `all` — every track with a source, including ones that are on disk and
        fine. This is the "pull the whole album down again" button: each track
        keeps playing off its current file until the new one lands, and the
        superseded file is deleted only after the replacement succeeds.
    """
    if scope not in ("missing", "all"):
        raise HTTPException(status_code=400, detail="scope must be 'missing' or 'all'")

    playlist = await db.get(Collection, playlist_id)
    if not playlist or (playlist.kind or "standard") != "playlist":
        raise HTTPException(status_code=404, detail="Playlist not found")

    rows = (
        await db.execute(
            select(Memo)
            .join(memo_collections, memo_collections.c.memo_id == Memo.id)
            .where(memo_collections.c.collection_id == playlist_id)
            .where((Memo.is_deleted == False) | (Memo.is_deleted == None))  # noqa: E712
            .where(Memo.source_url != None)  # noqa: E711
            .order_by(desc(Memo.recency_at), desc(Memo.created_at))
        )
    ).scalars().all()

    queued: list[str] = []
    # memo_id → the file this pass is replacing. The downloader unlinks it once
    # the new file has landed, so a forced re-pull does not leave the old one
    # orphaned under FILES_DIR (every localize writes a fresh uuid filename).
    replacing: dict[str, str] = {}
    for m in rows:
        if m.localize_status == "processing":
            continue  # already being fetched right now
        on_disk = resolve_memo_path(m.file_path) if m.file_path else None
        if scope == "missing" and on_disk is not None:
            continue  # already here and playable
        if m.file_path and on_disk is None:
            # The row points at a file that no longer exists. Drop the claim so
            # the track reads as remote (cloud chip back, progress honest).
            m.file_path = None
        elif on_disk is not None:
            replacing[m.id] = str(on_disk)
        m.localize_status = "pending"
        m.localize_error = None
        m.updated_at = datetime.utcnow()
        queued.append(m.id)
    await db.commit()

    if queued:
        from backend.api.ingest import clear_playlist_pause, download_playlist_task

        # Starting (or resuming) a download wipes any stale pause request.
        clear_playlist_pause(playlist_id)
        queue_task(download_playlist_task, playlist_id, queued, replacing)

    return {
        "id": playlist_id,
        "scope": scope,
        "queued": len(queued),
        "status": "processing" if queued else "nothing-to-do",
    }


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
