"""Automatic local backups of the library database.

openMemo had no automatic backup of any kind. On 2026-08-04 a library lost 435
media files and the only reason it was not a catastrophe is that the database —
every memo, note, caption, tag, collection and transcript — happened to survive
by accident. Media can usually be fetched again from its source. The database
cannot be fetched from anywhere.

So this backs up the database, on a timer, to `data/backups/`, and keeps the
last few. Deliberately NOT the media: a full backup of a 25 GB library written
on a schedule is a way to fill someone's disk, and the media is the part that
is re-downloadable. Use Settings → Backup (scope=full) for the whole thing.

Cheap enough to be boring: a SQLite `.backup()` of a few MB, gzipped, once a
day, with the oldest pruned.
"""
from __future__ import annotations

import asyncio
import gzip
import logging
import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path

from backend.config import settings

log = logging.getLogger(__name__)

# Once a day is the right cadence for something whose job is to bound how much
# work a disaster can erase.
_INTERVAL_S = 24 * 60 * 60

# Wait before the first one so a machine that boots and shuts down again does
# not spend its startup writing backups.
_STARTUP_DELAY_S = 5 * 60

# Enough history to survive "the problem started a few days ago and I only
# noticed now", without unbounded growth.
KEEP = 7


def backup_dir() -> Path:
    return Path(settings.DATA_DIR) / "backups"


def _db_path() -> Path:
    return Path(settings.DATA_DIR) / "openmemo.db"


def create_snapshot() -> Path | None:
    """Write one gzipped database snapshot. Returns its path, or None.

    Uses SQLite's own backup API rather than copying the file: the database is
    in WAL mode and live, so a plain copy can catch it mid-write.
    """
    src = _db_path()
    if not src.is_file():
        return None

    out_dir = backup_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    dest = out_dir / f"openmemo-{stamp}.db.gz"

    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / "openmemo.db"
        con = sqlite3.connect(str(src))
        try:
            target = sqlite3.connect(str(staged))
            try:
                con.backup(target)
            finally:
                target.close()
        finally:
            con.close()

        with open(staged, "rb") as fh, gzip.open(dest, "wb", compresslevel=6) as gz:
            shutil.copyfileobj(fh, gz)

    return dest


def prune(keep: int = KEEP) -> int:
    """Delete all but the newest `keep` snapshots. Returns how many went."""
    snaps = sorted(backup_dir().glob("openmemo-*.db.gz"))
    doomed = snaps[:-keep] if keep > 0 else []
    for p in doomed:
        try:
            p.unlink()
        except Exception as e:
            log.info("autobackup: could not prune %s: %r", p, e)
    return len(doomed)


def list_snapshots() -> list[dict]:
    """Newest first, for the Settings UI."""
    out = []
    for p in sorted(backup_dir().glob("openmemo-*.db.gz"), reverse=True):
        try:
            st = p.stat()
        except OSError:
            continue
        out.append({
            "name": p.name,
            "bytes": st.st_size,
            "created_at": datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z",
        })
    return out


def run_once() -> dict:
    """A snapshot plus a prune. Never raises."""
    try:
        path = create_snapshot()
        if path is None:
            return {"ok": False, "reason": "no database to back up"}
        pruned = prune()
        size = path.stat().st_size
        log.info("autobackup: wrote %s (%.1f KB), pruned %d", path.name, size / 1024, pruned)
        return {"ok": True, "name": path.name, "bytes": size, "pruned": pruned}
    except Exception as e:
        log.warning("autobackup failed: %r", e)
        return {"ok": False, "reason": str(e)[:200]}


async def run_backup_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out."""
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            await asyncio.to_thread(run_once)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("autobackup cycle failed: %r", e)
        await asyncio.sleep(_INTERVAL_S)


if __name__ == "__main__":
    import json

    print(json.dumps(run_once(), indent=2))
