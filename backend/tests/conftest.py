"""Test bootstrap: point the suite at a throwaway SQLite file.

Must run before anything imports backend.config — Settings reads the env at
import time. Real env vars beat this setdefault, so CI can still inject its
own DATABASE_URL.
"""
import os
import tempfile
from pathlib import Path

# A SQLAlchemy sqlite URL is `sqlite+aiosqlite:///<path>` where <path> must use
# forward slashes even on Windows — a raw `os.path.join` hands back a backslash
# path (C:\Users\...\test.db) that the URL parser mangles, which is what used to
# break every backend test in a Windows worktree. `Path.as_posix()` keeps the
# Windows drive letter but normalizes the separators (C:/Users/.../test.db), so
# the same line is valid on Windows, macOS, Linux, and CI alike (OPNMMO-0043).
_tmpdir = tempfile.mkdtemp(prefix="openmemo-test-")
_db_path = Path(_tmpdir, "test.db").as_posix()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_db_path}")
