"""Library integrity check — notice when the files the database references vanish.

On 2026-08-04 an unisolated test run deleted 435 media files from a live
library. The app kept serving pages for ninety minutes as if nothing had
happened: cards still rendered from cached thumbnails, search still worked, and
the loss was eventually spotted in a screenshot rather than by openMemo. By then
the SSD had reclaimed most of the blocks.

Nothing here would have prevented that. This is the part that was missing
afterwards: a periodic pass answering one question, **do the files the database
references still exist**, and saying so out loud the moment the answer changes.

A run reports one of:
    ok         — every referenced file resolves on disk
    missing    — some files are missing, and the number has not grown
    incident   — MORE files are missing than at the last check

The distinction matters. A library that has been missing 59 uploads for a month
is a known state, not news. A jump from 0 to 435 between two checks is an
incident, and it is worth being loud about while recovery is still possible.

Cheap by construction: one `stat` per referenced path, a few hundred in a
typical library, run on a timer and off the event loop.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

log = logging.getLogger(__name__)

# Hourly. Frequent enough that a loss is caught while the disk may still hold
# the blocks, rare enough to be invisible. The check is pure `stat` calls.
_INTERVAL_S = 60 * 60

# Wait before the first run so a cold start is not competing with migrations,
# the embedder warming up, and everything else the lifespan kicks off.
_STARTUP_DELAY_S = 2 * 60


def _scan_sync() -> dict:
    """Resolve every referenced path. Blocking: called via a thread.

    Media and thumbnails are counted separately on purpose. A thumbnail is
    regenerable and a missing one is cosmetic; a missing media file may be the
    only copy that existed. They also fail independently — the incident that
    prompted this left `files/thumbs` untouched while emptying everything else,
    which is exactly why the cards still looked fine."""
    from sqlalchemy import create_engine, text

    from backend.config import settings
    from backend.core.file_paths import resolve_memo_path

    # A plain synchronous connection: this runs in a worker thread, and the
    # async session/engine belongs to the event loop that is not in it.
    url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
    engine = create_engine(url, connect_args={"check_same_thread": False})
    try:
        with engine.connect() as con:
            rows = con.execute(
                text(
                    "select file_path, thumbnail_path, source_url from memos "
                    "where is_deleted = 0 or is_deleted is null"
                )
            ).fetchall()
    finally:
        engine.dispose()

    memos = len(rows)
    with_media = missing_media = recoverable = unrecoverable = 0
    with_thumb = missing_thumbs = 0

    for file_path, thumbnail_path, source_url in rows:
        if file_path:
            with_media += 1
            if resolve_memo_path(file_path) is None:
                missing_media += 1
                if (source_url or "").strip():
                    recoverable += 1
                else:
                    unrecoverable += 1
        # A remote thumbnail URL is not ours to lose, so only local ones count.
        if thumbnail_path and not str(thumbnail_path).startswith("http"):
            with_thumb += 1
            if resolve_memo_path(thumbnail_path) is None:
                missing_thumbs += 1

    return {
        "memos": memos,
        "with_media": with_media,
        "missing_media": missing_media,
        "recoverable": recoverable,
        "unrecoverable": unrecoverable,
        "with_thumb": with_thumb,
        "missing_thumbs": missing_thumbs,
    }


def _verdict(scan: dict, previous: dict | None) -> tuple[str, int]:
    """Status plus how much worse it got since the last run.

    Any increase is an incident. Files do not go missing on their own, so there
    is no drift to tolerate and no threshold worth tuning: one file that was
    here an hour ago and is not here now is the same class of event as four
    hundred, caught earlier."""
    now = scan["missing_media"] + scan["missing_thumbs"]
    if not previous:
        # First run ever. Report what is missing, but nothing has "jumped" —
        # calling a pre-existing state an incident would cry wolf on install.
        return ("missing" if now else "ok"), 0

    before = previous.get("missing_media", 0) + previous.get("missing_thumbs", 0)
    delta = now - before
    if delta > 0:
        return "incident", delta
    return ("missing" if now else "ok"), delta


async def run_integrity_check() -> dict:
    """Scan, compare against the last run, and return the result."""
    scan = await asyncio.to_thread(_scan_sync)
    previous = last_result()
    status, delta = _verdict(scan, previous)

    result = {
        **scan,
        "status": status,
        "delta": delta,
        "checked_at": datetime.utcnow().isoformat(),
        "previous_checked_at": (previous or {}).get("checked_at"),
    }

    if status == "incident":
        log.error(
            "library integrity: %d MORE files missing since %s (%d media, %d thumbnails)",
            delta, result["previous_checked_at"], scan["missing_media"], scan["missing_thumbs"],
        )
    elif status == "missing":
        log.info(
            "library integrity: %d media and %d thumbnails missing (unchanged)",
            scan["missing_media"], scan["missing_thumbs"],
        )
    return result


def last_result() -> dict | None:
    """What the last check found, for the Settings UI."""
    try:
        from backend.core.app_settings import get_library_integrity

        return get_library_integrity()
    except Exception:
        return None


async def store(result: dict) -> None:
    from backend.core.app_settings import set_library_integrity

    try:
        set_library_integrity(result)
    except Exception as e:
        log.info("library integrity could not store its result: %r", e)


async def run_integrity_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out.

    Every paired device runs its own, unlike the Instagram canary which elects a
    single machine to do the asking. This one is a question about the local
    disk, so each machine has its own answer and none of them substitutes."""
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            await store(await run_integrity_check())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("library integrity cycle failed: %r", e)
        await asyncio.sleep(_INTERVAL_S)


if __name__ == "__main__":
    import json

    async def _main() -> None:
        result = await run_integrity_check()
        await store(result)
        print(json.dumps(result, indent=2))

    asyncio.run(_main())
