"""One-process-per-host locks for services that must not run twice.

The Telegram relay is the reason this exists. `getUpdates` hands each message
to exactly ONE caller and then forgets it, so two backends polling the same bot
token do not duplicate work — they split it, at random, and neither one knows.

That is not hypothetical. Between 2026-08-09 and 2026-08-11 a dev backend
started from `dev-db.ps1` polled the same token as the live Docker container.
Both had `telegram_enabled` on, both were locked to the same owner id. Roughly
half the user's phone captures landed in `dev-data/openmemo-dev.db`, invisible
in the app on :8091. The bot answered "Saved ✓" every time, because from its
side the save had worked.

`may_run_singleton` (ADR-024 §3) already elects one DEVICE to poll, but it
cannot help here: it returns True whenever peer sync is off, and two processes
on one machine are one device. That gap sits at a different level, so this
guard does too — an OS lock on a file in the host's temp dir, outside any
DATA_DIR. Two backends with different data directories still contend for the
same lock, which is exactly the case that went wrong.

The lock is advisory, non-blocking, and released by the kernel when the process
dies, so a crashed backend leaves nothing to clean up and no staleness rule to
get wrong.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

# Held for the process lifetime. Keeping the file objects referenced here is
# what keeps the locks held — letting one be garbage collected closes the
# descriptor and releases it.
_HELD: dict[str, object] = {}


def _lock_path(name: str) -> Path:
    return Path(tempfile.gettempdir()) / f"openmemo-{name}.lock"


def _try_lock(handle) -> bool:
    """Take an exclusive non-blocking lock on an open file. False if taken.

    The `seek(0)` is load-bearing on Windows. `msvcrt.locking` locks a byte
    RANGE starting at the current file position, and a handle opened "a+" sits
    at end-of-file — so a second process would lock a byte past the first
    one's, both calls would succeed, and the guard would quietly pass everyone
    through. POSIX `flock` is whole-file and does not care, so seeking first is
    correct on both.
    """
    try:
        handle.seek(0)
    except OSError:
        return False

    try:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except ImportError:
        pass
    except OSError:
        return False

    try:
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except OSError:
        return False


def claim(name: str) -> bool:
    """Claim the host-wide slot for `name`. True if this process now owns it.

    Idempotent: a second call from the same process returns True without
    re-locking. A failure to lock is always reported as "someone else has it",
    never as an error — a guard that crashes the service it guards is worse
    than the duplicate it was meant to stop.
    """
    if name in _HELD:
        return True

    path = _lock_path(name)
    try:
        handle = open(path, "a+")
    except OSError as e:
        log.warning("host lock %s could not be opened (%r) — running unguarded", path, e)
        return True

    if not _try_lock(handle):
        handle.close()
        return False

    try:
        handle.seek(0)
        handle.truncate()
        handle.write(f"{os.getpid()}\n")
        handle.flush()
    except OSError:
        # The lock is what matters; the pid inside it is only for a human
        # reading the file to work out which process is holding it. Rewriting
        # the contents does not disturb the locked range on either platform.
        pass

    _HELD[name] = handle
    return True


def release(name: str) -> None:
    """Give up a claimed slot. Mostly for tests — process exit does this."""
    handle = _HELD.pop(name, None)
    if handle is not None:
        try:
            handle.close()
        except OSError:
            pass
