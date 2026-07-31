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

from typing import Any

from backend.core.jobs import register

# Job kind names. Constants rather than bare strings so a typo is an
# ImportError at startup instead of a ValueError on a live ingest route.
KIND_PROCESS = "process"
KIND_PROCESS_FILE = "process_file"
KIND_THUMBNAIL = "thumbnail"
KIND_LOCALIZE = "localize"
KIND_TRANSCRIBE = "transcribe"
KIND_TRANSCRIPT = "transcript"
KIND_PLAYLIST_DOWNLOAD = "playlist_download"
KIND_PLAYLIST_THUMBS = "playlist_thumbs"


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


@register(KIND_LOCALIZE, concurrency=3)
async def _localize(payload: dict[str, Any]) -> None:
    """Handles both localize entry points. `mode` absent means the auto-localize
    path (`_localize_memo_task`), which picks the mode itself."""
    from backend.api.ingest import _localize_memo_task, localize_memo_task

    mode = payload.get("mode")
    if mode is None:
        await _localize_memo_task(payload["memo_id"])
    else:
        await localize_memo_task(
            payload["memo_id"], mode, payload.get("quality", 1080)
        )


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

    await download_playlist_task(payload["collection_id"], payload["memo_ids"])


@register(KIND_PLAYLIST_THUMBS, concurrency=1)
async def _playlist_thumbs(payload: dict[str, Any]) -> None:
    from backend.api.ingest import cache_playlist_thumbs_task

    await cache_playlist_thumbs_task(payload["memo_ids"])
