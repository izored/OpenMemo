"""Registers every background task kind with the job queue (ADR-024 §9).

One place that maps a queue `kind` onto the coroutine that does the work, and
sets how many of that kind may run at once. Splitting this out of `jobs.py`
keeps the queue itself free of any dependency on the API layer, and splitting it
out of `ingest.py` avoids an import cycle (the task functions live there and
would otherwise have to import the registry that imports them).

**This module must be imported before `jobs.start_workers()`** — the queue is a
no-op while nothing is registered, so a missed import means a silently idle
queue rather than a crash. `backend/main.py` imports it during startup.

Concurrency caps are deliberate, not arbitrary:

* Network-bound work (downloads, localize) runs a few at a time. The bug this
  queue exists to fix was 40 simultaneous yt-dlp processes saturating CPU, disk
  and bandwidth until downloads failed on timeouts they would have survived
  serially.
* `transcribe` is capped at 1 because a single Whisper model is not
  concurrency-safe — `transcribe.py` already serializes inference behind a lock,
  so anything above 1 would queue on that lock anyway while holding a worker.
* `embed` is capped at 1 for the same reason on the Ollama side.
* Thumbnails are cheap and short, so they get the widest lane.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from backend.core import jobs
from backend.core.jobs import register

logger = logging.getLogger(__name__)

# Job kind names. Constants rather than bare strings so a typo is an
# ImportError at startup instead of a ValueError on a live ingest route.
KIND_PROCESS = "process"
KIND_PROCESS_FILE = "process_file"
KIND_THUMBNAIL = "thumbnail"
# Localizing EVERY slide of a carousel, as opposed to the single cover image
# KIND_THUMBNAIL handles. Its own kind because the two run for the same memo and
# dedupe keys on (kind, memo_id) — sharing one would drop the gallery pass.
KIND_GALLERY = "gallery"
KIND_LOCALIZE = "localize"
# Auto-localize is a SEPARATE kind from explicit localize on purpose. Both
# fire for the same memo on the auto-download path (ingest.py ~2215), and
# dedupe keys on (kind, memo_id) — one shared kind would silently drop the
# explicit job and quietly break "make it local".
KIND_LOCALIZE_AUTO = "localize_auto"
# Re-pull is its own kind for the same reason auto-localize is: it can be asked
# for while a localize is already queued for the same memo, and dedupe keys on
# (kind, memo_id) — sharing a kind would silently swallow one of them.
KIND_REPULL = "repull"
# The automatic second READ after a degraded save. Its own kind, for the same
# reason KIND_LOCALIZE_AUTO is separate from KIND_LOCALIZE: `enqueue` dedupes on
# (kind, memo_id), so sharing `repull` would let a pending automatic retry
# silently swallow the user's own explicit re-pull click on that memo. It also
# carries NO mode, because it never downloads, and the repull handler requires
# one — routing it at `repull` made every one of these die with KeyError inside
# the worker, so the feature shipped completely dead. Caught in review.
KIND_RERESOLVE = "reresolve"
KIND_TRANSCRIBE = "transcribe"
KIND_TRANSCRIPT = "transcript"
KIND_PLAYLIST_DOWNLOAD = "playlist_download"
KIND_PLAYLIST_THUMBS = "playlist_thumbs"
# Repair, not ingest: a picture that was never copied to disk, re-resolving the
# post first when its signed URL has already expired.
KIND_RELOCALIZE_PICTURES = "relocalize_pictures"


@register(KIND_PROCESS, concurrency=2)
async def _process(payload: dict[str, Any]) -> None:
    from backend.api.ingest import process_memo

    await process_memo(payload["memo_id"])


@register(KIND_PROCESS_FILE, concurrency=2)
async def _process_file(payload: dict[str, Any]) -> None:
    from backend.api.ingest import process_file_memo

    await process_file_memo(payload["memo_id"], payload["file_path"], payload["memo_type"])


@register(KIND_THUMBNAIL, concurrency=4)
async def _thumbnail(payload: dict[str, Any]) -> None:
    from backend.api.ingest import cache_thumbnail

    await cache_thumbnail(payload["memo_id"])


@register(KIND_GALLERY, concurrency=2)
async def _gallery(payload: dict[str, Any]) -> None:
    from backend.api.ingest import cache_gallery

    await cache_gallery(payload["memo_id"])


@register(KIND_RELOCALIZE_PICTURES, concurrency=2)
async def _relocalize_pictures(payload: dict[str, Any]) -> None:
    from backend.api.ingest import relocalize_pictures_task

    await relocalize_pictures_task(payload["memo_id"])


@register(KIND_LOCALIZE, concurrency=3)
async def _localize(payload: dict[str, Any]) -> None:
    """Explicit localize: the caller chose the mode."""
    from backend.api.ingest import localize_memo_task

    await localize_memo_task(
        payload["memo_id"], payload["mode"], payload.get("quality", 1080)
    )


@register(KIND_REPULL, concurrency=2)
async def _repull(payload: dict[str, Any]) -> None:
    """Re-pull: resolve the source again, download it, rebuild the cover."""
    from backend.api.ingest import repull_memo_task

    await repull_memo_task(payload["memo_id"], payload["mode"])


@register(KIND_RERESOLVE, concurrency=2)
async def _reresolve(payload: dict[str, Any]) -> None:
    """Re-read the source and apply what comes back. Downloads nothing."""
    from backend.api.ingest import reresolve_memo_task

    await reresolve_memo_task(payload["memo_id"])


@register(KIND_LOCALIZE_AUTO, concurrency=3)
async def _localize_auto(payload: dict[str, Any]) -> None:
    """Auto-localize: works out its own mode from the memo."""
    from backend.api.ingest import _localize_memo_task

    await _localize_memo_task(payload["memo_id"])


@register(KIND_TRANSCRIBE, concurrency=1)
async def _transcribe(payload: dict[str, Any]) -> None:
    from backend.api.ingest import transcribe_memo_task

    await transcribe_memo_task(payload["memo_id"])


@register(KIND_TRANSCRIPT, concurrency=1)
async def _transcript(payload: dict[str, Any]) -> None:
    from backend.api.ingest import transcript_memo_task

    await transcript_memo_task(payload["memo_id"])


@register(KIND_PLAYLIST_DOWNLOAD, concurrency=1)
async def _playlist_download(payload: dict[str, Any]) -> None:
    """Whole-playlist ingest. Capped at 1 because each job already downloads a
    batch of tracks internally — running several would multiply out."""
    from backend.api.ingest import download_playlist_task

    await download_playlist_task(
        payload["collection_id"],
        payload["memo_ids"],
        # Absent on jobs enqueued before forced re-downloads existed.
        payload.get("replacing") or None,
    )


@register(KIND_PLAYLIST_THUMBS, concurrency=1)
async def _playlist_thumbs(payload: dict[str, Any]) -> None:
    from backend.api.ingest import cache_playlist_thumbs_task

    await cache_playlist_thumbs_task(payload["memo_ids"])


# ---------------------------------------------------------------------------
# queue_task — the drop-in replacement for BackgroundTasks.add_task
# ---------------------------------------------------------------------------

# Maps a task function to (kind, how its positional args become a payload).
# Keyed by function NAME rather than the function object on purpose: the task
# functions live in backend.api.ingest, which imports this module for
# queue_task, so importing them here would be a cycle.
def _p_memo(args: tuple) -> tuple[str | None, dict[str, Any]]:
    return (args[0] if args else None), {}


def _p_localize(args: tuple) -> tuple[str | None, dict[str, Any]]:
    # localize_memo_task(memo_id, mode, quality=1080)
    payload: dict[str, Any] = {"mode": args[1]}
    if len(args) > 2:
        payload["quality"] = args[2]
    return args[0], payload


def _p_localize_auto(args: tuple) -> tuple[str | None, dict[str, Any]]:
    # _localize_memo_task(memo_id) — picks its own mode, so no "mode" key.
    return args[0], {}


def _p_process_file(args: tuple) -> tuple[str | None, dict[str, Any]]:
    # process_file_memo(memo_id, file_path, memo_type)
    return args[0], {"file_path": args[1], "memo_type": args[2]}


def _p_playlist_download(args: tuple) -> tuple[str | None, dict[str, Any]]:
    # download_playlist_task(collection_id, memo_ids, replacing=None) — not
    # per-memo work, so memo_id stays None and dedupe does not apply (NULLs are
    # distinct). `replacing` carries the files a forced re-pull supersedes.
    payload: dict[str, Any] = {"collection_id": args[0], "memo_ids": list(args[1])}
    if len(args) > 2 and args[2]:
        payload["replacing"] = dict(args[2])
    return None, payload


def _p_playlist_thumbs(args: tuple) -> tuple[str | None, dict[str, Any]]:
    return None, {"memo_ids": list(args[0])}


_ROUTING: dict[str, tuple[str, Callable[[tuple], tuple[str | None, dict[str, Any]]]]] = {
    "process_memo": (KIND_PROCESS, _p_memo),
    "process_file_memo": (KIND_PROCESS_FILE, _p_process_file),
    "cache_thumbnail": (KIND_THUMBNAIL, _p_memo),
    # Was missing: every carousel save reached `queue_task(cache_gallery, …)`
    # and raised "unrouted function" AFTER the memo was committed, so the save
    # 500'd and no slide was ever downloaded to disk.
    "cache_gallery": (KIND_GALLERY, _p_memo),
    "relocalize_pictures_task": (KIND_RELOCALIZE_PICTURES, _p_memo),
    "localize_memo_task": (KIND_LOCALIZE, _p_localize),
    "repull_memo_task": (KIND_REPULL, _p_localize),
    # Resolve-only retry after a degraded read. Persists just the memo id, so
    # it can never be replayed as a download with some other mode.
    "reresolve_memo_task": (KIND_RERESOLVE, _p_memo),
    "_localize_memo_task": (KIND_LOCALIZE_AUTO, _p_localize_auto),
    "transcribe_memo_task": (KIND_TRANSCRIBE, _p_memo),
    "transcript_memo_task": (KIND_TRANSCRIPT, _p_memo),
    "download_playlist_task": (KIND_PLAYLIST_DOWNLOAD, _p_playlist_download),
    "cache_playlist_thumbs_task": (KIND_PLAYLIST_THUMBS, _p_playlist_thumbs),
}


def queue_task(fn, *args) -> None:
    """Hand a background chore to the durable queue.

    Signature-compatible with `BackgroundTasks.add_task(fn, *args)` and with the
    `schedule(fn, *args)` callable that `ingest_url_core` accepts (the Telegram
    relay passes its own). That compatibility is the point: every call site is a
    one-word change and no function signature moves.

    Stays **synchronous** deliberately. Making it async would mean awaiting it at
    ~28 call sites and changing `ingest_url_core`'s contract plus the relay's
    scheduler — a much wider blast radius for no gain, since the durability that
    matters starts the moment the row is inserted, not when the coroutine is
    created. The insert itself is scheduled with a done-callback that logs
    failures, the same pattern `schedule_processing` already uses (plans/007).

    An unroutable function is a programming error and raises immediately rather
    than silently dropping the user's work.
    """
    name = getattr(fn, "__name__", str(fn))
    route = _ROUTING.get(name)
    if route is None:
        raise ValueError(
            f"queue_task got an unrouted function {name!r} — add it to _ROUTING"
        )
    kind, to_payload = route
    memo_id, payload = to_payload(args)

    async def _enqueue() -> None:
        await jobs.enqueue(kind, memo_id=memo_id, payload=payload)

    task = asyncio.create_task(_enqueue())

    def _log(t: asyncio.Task) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error("jobs: failed to enqueue %s for %s: %s", kind, memo_id, exc)

    task.add_done_callback(_log)
