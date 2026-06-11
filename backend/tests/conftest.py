"""Test bootstrap: point the suite at a throwaway SQLite file.

Must run before anything imports backend.config — Settings reads the env at
import time. Real env vars beat this setdefault, so CI can still inject its
own DATABASE_URL.
"""
import os
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="openmemo-test-")
os.environ.setdefault(
    "DATABASE_URL", f"sqlite+aiosqlite:///{os.path.join(_tmpdir, 'test.db')}"
)
