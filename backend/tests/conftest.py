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
#
# DATA_DIR must point at the SAME throwaway dir, and DATABASE_URL at the
# `openmemo.db` inside it: init_db() creates the tables via SQLAlchemy on
# DATABASE_URL, but _run_migrations() opens `DATA_DIR / "openmemo.db"` directly
# with aiosqlite. If the two disagree (the default, where a worktree has no
# seeded ./data DB), the migration pass runs ALTER TABLE against an empty file
# and every test errors with "no such table: memos". Keeping them on one file
# fixes that in a fresh worktree.
_tmpdir = tempfile.mkdtemp(prefix="openmemo-test-")
_db_path = Path(_tmpdir, "openmemo.db").as_posix()
os.environ.setdefault("DATA_DIR", _tmpdir)
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{_db_path}")

# FILES_DIR must be a throwaway too, and this line is not optional bookkeeping.
# It was missing, and on 2026-08-04 running the suite from a real checkout
# DESTROYED A LIVE MEDIA LIBRARY: 435 files, every video, song and upload.
#
# The mechanism: settings.FILES_DIR defaulted to the repo's own `files/`, and
# test_backup_restore_safety.py posts a scope="full" archive to
# /api/backup/restore. A full restore deletes everything in the files directory
# except `thumbs` before unpacking — so the suite faithfully wiped the real one.
# The DB survived only because DATA_DIR above was already isolated, which is
# exactly why the damage looked mysterious instead of obvious.
#
# Any test that writes through settings.FILES_DIR now writes here. Never point
# this at the repo. test_test_isolation.py fails the suite if it ever drifts.
_files_dir = Path(_tmpdir, "files")
_files_dir.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("FILES_DIR", str(_files_dir))

# The job-queue worker pool keeps its worker set and shutdown Event in module
# globals — fine for the app (one event loop for its whole life), wrong for a
# suite that builds a TestClient per test, each with its own loop. Workers
# spawned in one test's loop outlived it and interfered with the next, which
# surfaced as GET /api/memos intermittently returning an empty list. The queue
# itself is covered directly by test_jobs_queue.py.
os.environ.setdefault("OPENMEMO_DISABLE_JOB_WORKERS", "1")
