"""Scheduled archives — one verified file per run, written where you choose.

openMemo could already build a backup zip, but only as a browser download, so a
backup existed if and only if someone remembered to click. On 2026-08-04 nobody
had, and 435 media files went with the incident.

This writes the same kind of archive on a timer, to a folder you pick, and then
**opens it again to check it is real**. Three scopes, because the parts of a
library are not equally replaceable:

    database   the whole library minus its media. A few MB. Memos, notes,
               captions, tags, collections, transcripts — none of which exist
               anywhere else. Daily.
    essential  the database plus every file with no `source_url`: uploads,
               voice memos, photos taken on a phone. On the library this was
               written for, ~2 GB against 25 GB, and it would have contained
               all 59 files that the incident destroyed for good. Weekly.
    full       everything, including media that could be re-downloaded from its
               source. Large and slow. Monthly.

Rules that come from the incident rather than from good practice in general:

- **Verify before counting.** A written archive is reopened, its database
  extracted and checked for a `memos` table, and the row count recorded. An
  archive that fails verification is deleted, does not count toward retention,
  and does not age out a good one.
- **Refuse to archive nothing.** If the database says there should be media and
  the archive collected none, that is a symptom, not a state worth preserving.
  Fail loudly and keep the previous archives.
- **Destination outside the app directory.** Configurable precisely so that
  whatever wipes the app cannot wipe its backups too. The default stays inside
  `data/` because a default that points at someone else's disk is worse.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from backend.config import settings

log = logging.getLogger(__name__)

SCOPES = ("database", "essential", "full")

# How often each scope runs, and how many of each are kept. Cheap history where
# it is cheap: the database is a few MB, the full archive is tens of GB.
SCHEDULE = {
    "database": {"every_s": 24 * 60 * 60, "keep": 14},
    "essential": {"every_s": 7 * 24 * 60 * 60, "keep": 4},
    "full": {"every_s": 30 * 24 * 60 * 60, "keep": 2},
}

# The loop wakes up this often and runs whatever is due. It does NOT sleep for
# a month: a machine that is off most of the time would never reach the wake-up.
_TICK_S = 60 * 60
_STARTUP_DELAY_S = 15 * 60

_META = "backup_meta.json"
_DB = "openmemo.db"
_FILES_PREFIX = "files/"


def destination() -> Path:
    """Where archives are written. Configurable; `data/backups` by default."""
    from backend.core.app_settings import get_backup_dest

    configured = (get_backup_dest() or "").strip()
    return Path(configured) if configured else Path(settings.DATA_DIR) / "backups"


def _db_path() -> Path:
    return Path(settings.DATA_DIR) / "openmemo.db"


def _sqlite_backup(src: Path, dst: Path) -> None:
    """SQLite's own backup API, not a file copy: the database is live and in
    WAL mode, so a copy can catch it mid-write."""
    a = sqlite3.connect(str(src))
    b = sqlite3.connect(str(dst))
    try:
        a.backup(b)
    finally:
        b.close()
        a.close()


def _upload_paths() -> tuple[list[Path], int]:
    """Files belonging to memos with no source. Returns (found, expected).

    `expected` is how many the database references, `found` is how many are
    actually on disk. They differ when files have already been lost, which is
    the case this exists for — the archive should still be written, but the
    caller needs both numbers to tell "nothing to archive" from "everything is
    already gone"."""
    from backend.core.file_paths import resolve_memo_path

    con = sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "select file_path from memos "
            "where (is_deleted = 0 or is_deleted is null) "
            "  and file_path is not null and file_path <> '' "
            "  and (source_url is null or source_url = '')"
        ).fetchall()
    finally:
        con.close()

    found = []
    for (stored,) in rows:
        resolved = resolve_memo_path(stored)
        if resolved is not None:
            found.append(resolved)
    return found, len(rows)


def _all_media_paths() -> tuple[list[Path], int]:
    """Everything under FILES_DIR except the thumbnail cache, which rides along
    separately — see `_thumbnail_paths`."""
    files_dir = Path(settings.FILES_DIR)
    if not files_dir.exists():
        return [], 0
    thumbs = files_dir / "thumbs"
    out = [
        f for f in files_dir.rglob("*")
        if f.is_file() and thumbs not in f.parents and f.parent != thumbs
    ]
    return out, len(out)


def _thumbnail_paths() -> list[Path]:
    """The card covers. Technically regenerable, and included anyway.

    Restoring a full archive into an empty install and finding 693 broken cards
    is what proved this: regenerating them means re-resolving posts over the
    network, one memo at a time, and every card is broken until it finishes. At
    86 MB against a 4.5 GB archive the cost of carrying them is a rounding
    error, and it is the difference between restoring a library and restoring a
    library-shaped hole.

    They are NOT counted toward the "refuse to archive nothing" check: that
    check is about media that exists nowhere else, and a thumbnail is not it.
    """
    thumbs = Path(settings.FILES_DIR) / "thumbs"
    if not thumbs.is_dir():
        return []
    return [f for f in thumbs.rglob("*") if f.is_file()]


def verify(archive: Path) -> dict:
    """Open a written archive and prove the database inside is usable.

    A backup nobody has opened is a hypothesis. This is the cheapest possible
    version of restoring one: unpack the database, confirm it is real SQLite
    with a `memos` table, and count the rows."""
    try:
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()
            if _DB not in names:
                return {"ok": False, "reason": "archive has no database"}
            with tempfile.TemporaryDirectory() as tmp:
                extracted = Path(tmp) / _DB
                with zf.open(_DB) as src, open(extracted, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                if extracted.read_bytes()[:16] != b"SQLite format 3\x00":
                    return {"ok": False, "reason": "database inside is not SQLite"}
                con = sqlite3.connect(str(extracted))
                try:
                    tables = {
                        r[0] for r in con.execute(
                            "select name from sqlite_master where type='table'"
                        )
                    }
                    if "memos" not in tables:
                        return {"ok": False, "reason": "database has no memos table"}
                    memos = con.execute("select count(*) from memos").fetchone()[0]
                finally:
                    con.close()
            # Covers are counted apart from media. `media_files` feeds the
            # "did this run carry anything irreplaceable" question on the NEXT
            # run, and thumbnails would answer it yes forever.
            thumb_prefix = _FILES_PREFIX + "thumbs/"
            media = sum(
                1 for n in names
                if n.startswith(_FILES_PREFIX) and not n.startswith(thumb_prefix)
            )
            thumbs = sum(1 for n in names if n.startswith(thumb_prefix))
        return {"ok": True, "memos": memos, "media_files": media, "thumbnails": thumbs}
    except (zipfile.BadZipFile, OSError, sqlite3.Error) as e:
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"[:200]}


def prune(scope: str, keep: int | None = None) -> int:
    """Delete all but the newest `keep` archives OF THIS SCOPE.

    Per-scope on purpose: a monthly full archive must not be aged out by
    fourteen daily database ones."""
    if keep is None:
        keep = SCHEDULE[scope]["keep"]
    existing = sorted(destination().glob(f"openmemo-{scope}-*.zip"))
    doomed = existing[:-keep] if keep > 0 else []
    for p in doomed:
        try:
            p.unlink()
        except OSError as e:
            log.info("archive: could not prune %s: %r", p, e)
    return len(doomed)


def create(scope: str) -> dict:
    """Write one archive, verify it, prune the old ones, record the outcome.

    Recording is part of the operation, not bookkeeping around it: the stored
    record is what the NEXT run reads to decide whether an empty media set means
    "something was lost" or "it was already gone". A create that did not store
    would make that judgement on stale information."""
    result = _create(scope)
    try:
        from backend.core.app_settings import get_backup_runs, set_backup_runs

        runs = get_backup_runs() or {}
        runs[scope] = result
        set_backup_runs(runs)
    except Exception as e:
        log.info("archive: could not record the %s run: %r", scope, e)
    return result


def _create(scope: str) -> dict:
    """Write one archive and verify it. Never raises.

    The order matters: verification happens before pruning, so a run that
    produces a broken archive cannot delete a good one on its way out."""
    if scope not in SCOPES:
        return {"ok": False, "scope": scope, "reason": f"unknown scope {scope!r}"}
    if not _db_path().is_file():
        return {"ok": False, "scope": scope, "reason": "no database to archive"}

    try:
        dest_dir = destination()
        dest_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        return {"ok": False, "scope": scope, "reason": f"destination unusable: {e}"[:200]}

    if scope == "essential":
        media, expected = _upload_paths()
    elif scope == "full":
        media, expected = _all_media_paths()
    else:
        media, expected = [], 0

    # Refuse to archive nothing — but only when there was something to lose.
    #
    # The rule exists so a wipe cannot rotate the last good archive out of
    # retention: if the previous successful run of this scope carried media and
    # this one finds none, something happened between them and the archives on
    # disk are worth more than a new one.
    #
    # When no previous run ever carried media, the files were already gone
    # before this feature existed. Refusing there would fail the scope forever
    # and teach the user to ignore it, so the archive is written and marked
    # degraded instead — the database inside is still worth having.
    previous = (last_runs().get(scope) or {})
    had_media = bool(previous.get("ok")) and (previous.get("media_files") or 0) > 0
    degraded = False
    if expected > 0 and not media:
        if had_media:
            log.error(
                "archive: %s scope found 0 of %d expected media files, and the "
                "last run carried %d — refusing to write. Previous archives are "
                "untouched.", scope, expected, previous.get("media_files") or 0,
            )
            return {
                "ok": False, "scope": scope, "expected_media": expected,
                "media_files": 0,
                "reason": f"expected {expected} media files, found none on disk",
            }
        degraded = True
        log.warning(
            "archive: %s scope expects %d media files and none are on disk — "
            "writing the database anyway, since none were there last time either.",
            scope, expected,
        )

    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    out = dest_dir / f"openmemo-{scope}-{stamp}.zip"
    files_dir = Path(settings.FILES_DIR)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / _DB
            _sqlite_backup(_db_path(), staged)

            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
                zf.writestr(_META, json.dumps({
                    # Restore only knows "structure" and "full". An essential
                    # archive carries real media, so it must restore like a full
                    # one or its files would be ignored.
                    "scope": "full" if scope in ("essential", "full") else "structure",
                    "archive_scope": scope,
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "app_version": settings.VERSION,
                }, indent=2))
                zf.write(staged, _DB)
                # Covers ride along with anything that carries media at all, so
                # a restore lands on a library that looks like one.
                for f in (media + (_thumbnail_paths() if scope != "database" else [])):
                    try:
                        rel = f.relative_to(files_dir).as_posix()
                    except ValueError:
                        rel = f.name
                    zf.write(f, _FILES_PREFIX + rel)
    except (OSError, zipfile.BadZipFile) as e:
        out.unlink(missing_ok=True)
        log.warning("archive: %s failed to write: %r", scope, e)
        return {"ok": False, "scope": scope, "reason": f"write failed: {e}"[:200]}

    checked = verify(out)
    if not checked["ok"]:
        # A broken archive is worse than no archive, because it looks like one.
        out.unlink(missing_ok=True)
        log.error("archive: %s failed verification (%s) — deleted, previous kept",
                  scope, checked["reason"])
        return {"ok": False, "scope": scope, "reason": f"verification: {checked['reason']}"}

    size = out.stat().st_size
    pruned = prune(scope)
    log.info("archive: %s wrote %s (%.1f MB, %d memos, %d media), pruned %d",
             scope, out.name, size / 1024 / 1024, checked["memos"],
             checked["media_files"], pruned)
    return {
        "ok": True,
        "scope": scope,
        "name": out.name,
        "path": str(out),
        "bytes": size,
        "memos": checked["memos"],
        "media_files": checked["media_files"],
        "thumbnails": checked.get("thumbnails", 0),
        "expected_media": expected,
        # True when the database references media that is not on disk to
        # archive. The archive is real and restorable; it just cannot contain
        # what no longer exists.
        "degraded": degraded,
        "verified": True,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "pruned": pruned,
    }


def list_archives() -> list[dict]:
    """Newest first, for the Settings UI."""
    out = []
    for scope in SCOPES:
        for p in destination().glob(f"openmemo-{scope}-*.zip"):
            try:
                st = p.stat()
            except OSError:
                continue
            out.append({
                "name": p.name,
                "scope": scope,
                "bytes": st.st_size,
                "created_at": datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z",
            })
    return sorted(out, key=lambda a: a["created_at"], reverse=True)


def _due(scope: str, runs: dict) -> bool:
    last = (runs.get(scope) or {}).get("created_at")
    if not last:
        return True
    try:
        when = datetime.fromisoformat(last.rstrip("Z"))
    except ValueError:
        return True
    return (datetime.utcnow() - when).total_seconds() >= SCHEDULE[scope]["every_s"]


def run_due() -> list[dict]:
    """Run whichever scopes are due. Returns one record per attempt.

    A failed run is recorded too, so it is visible in Settings and so a broken
    destination does not look like a schedule that simply has not fired yet."""
    from backend.core.app_settings import get_backup_runs

    runs = get_backup_runs() or {}
    # `create` records each run itself, which is also what makes a scope stop
    # being due.
    return [create(scope) for scope in SCOPES if _due(scope, runs)]


def last_runs() -> dict:
    from backend.core.app_settings import get_backup_runs

    return get_backup_runs() or {}


async def run_archive_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out."""
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            await asyncio.to_thread(run_due)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("archive cycle failed: %r", e)
        await asyncio.sleep(_TICK_S)


if __name__ == "__main__":
    import sys

    scope = sys.argv[1] if len(sys.argv) > 1 else "database"
    print(json.dumps(create(scope), indent=2))
