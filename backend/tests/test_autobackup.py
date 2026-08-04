"""Automatic database snapshots.

The media loss on 2026-08-04 was survivable only because the database happened
to be untouched. Media is usually re-downloadable; notes, captions, tags and
transcripts are not. These snapshots exist so that stops being luck.
"""
import gzip
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.core import autobackup


@pytest.fixture
def app_started():
    """Boot the app once so the throwaway database file actually exists.

    Without this the test passes or fails depending on whether some earlier
    test happened to start the app first — there is nothing to snapshot until
    the lifespan has created the schema.
    """
    from backend.main import app

    with TestClient(app):
        yield


def test_snapshot_is_a_real_readable_database(app_started):
    path = autobackup.create_snapshot()
    assert path is not None and path.is_file()
    assert path.parent == Path(settings.DATA_DIR) / "backups"

    # It must actually open as SQLite once decompressed — a backup you cannot
    # restore is not a backup.
    raw = gzip.decompress(path.read_bytes())
    assert raw[:16] == b"SQLite format 3\x00"

    tmp = path.with_suffix(".check.db")
    tmp.write_bytes(raw)
    try:
        con = sqlite3.connect(str(tmp))
        names = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        con.close()
        assert "memos" in names
    finally:
        tmp.unlink(missing_ok=True)


def test_prune_keeps_only_the_newest():
    d = autobackup.backup_dir()
    d.mkdir(parents=True, exist_ok=True)
    for existing in d.glob("openmemo-*.db.gz"):
        existing.unlink()

    for i in range(6):
        (d / f"openmemo-2026010{i}-000000.db.gz").write_bytes(b"x")

    removed = autobackup.prune(keep=2)
    left = sorted(p.name for p in d.glob("openmemo-*.db.gz"))
    assert removed == 4
    assert left == ["openmemo-20260104-000000.db.gz", "openmemo-20260105-000000.db.gz"]


def test_listing_is_newest_first():
    d = autobackup.backup_dir()
    d.mkdir(parents=True, exist_ok=True)
    for existing in d.glob("openmemo-*.db.gz"):
        existing.unlink()
    for name in ("openmemo-20260101-000000.db.gz", "openmemo-20260202-000000.db.gz"):
        (d / name).write_bytes(b"x")

    snaps = autobackup.list_snapshots()
    assert [s["name"] for s in snaps][0] == "openmemo-20260202-000000.db.gz"
    assert all("bytes" in s and "created_at" in s for s in snaps)


def test_run_once_never_raises_without_a_database(monkeypatch, tmp_path):
    monkeypatch.setattr(autobackup, "_db_path", lambda: tmp_path / "nope.db")
    result = autobackup.run_once()
    assert result["ok"] is False
