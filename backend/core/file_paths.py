"""Tolerant resolver for memo file_path values.

Background: image/file memos store an absolute path in `memos.file_path`.
That path is whatever was absolute at the time of ingest, so a memo created
inside Docker holds `/app/files/<ws>/<file>`, and a memo created via the
local `dev.ps1` uvicorn holds `D:\\...\\OpenMemo\\files\\<ws>\\<file>`.

When the user flips between Docker and local dev (or moves the repo), the
stored path stops resolving and image rendering / file download 404s. Rather
than backfill the DB on every environment switch, the file-serving routes
call `resolve_memo_path()` which:

1. Returns the stored path verbatim if it already exists on disk.
2. Otherwise re-anchors anything after the literal directory name `files`
   onto the current `settings.FILES_DIR`.

If neither resolution finds a file, returns None and the caller raises 404.
"""
from pathlib import Path, PurePosixPath, PureWindowsPath

from backend.config import settings


def _split_after_files(stored: str) -> tuple[str, ...] | None:
    """Return the components after the last `files` segment, or None."""
    # Stored path may be Docker (posix) or Windows; parse both.
    for cls in (PurePosixPath, PureWindowsPath):
        try:
            parts = cls(stored).parts
        except Exception:
            continue
        # Find the LAST occurrence of "files" so a username like "files" in
        # the user dir doesn't confuse the split.
        rev = list(reversed(parts))
        if "files" in rev:
            i_from_end = rev.index("files")
            tail = parts[len(parts) - i_from_end :]
            if tail:
                return tail
    return None


def resolve_memo_path(stored: str | None) -> Path | None:
    """Resolve a stored file_path to an on-disk Path, or None."""
    if not stored:
        return None

    p = Path(stored)
    try:
        if p.exists():
            return p
    except OSError:
        pass

    tail = _split_after_files(stored)
    if tail:
        candidate = Path(settings.FILES_DIR).joinpath(*tail)
        if candidate.exists():
            return candidate

    return None
