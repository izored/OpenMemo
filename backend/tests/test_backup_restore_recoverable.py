"""Restore has to be survivable, and every backup we write has to be usable.

Two gaps this locks shut.

The app produced backups in two shapes and could only restore one. Settings
made a zip; the scheduled job and the Mac app's pre-update copy wrote gzipped
SQLite straight to disk. The restore endpoint rejected the second at its first
line, and the file picker would not even offer it, so a year of daily snapshots
was insurance that could not be claimed.

And restore itself kept no copy of the database it replaced. It had moved media
aside since the 2026-08-04 incident, on the stated principle that a recovery
tool should not be the most destructive button in the app, but the memos it
overwrote were simply gone. Restoring an old backup to recover one deleted memo
took everything since with it.
"""
import gzip
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _data_dir() -> Path:
    from backend.config import settings

    return Path(settings.DATA_DIR)


def _current_db_bytes() -> bytes:
    """The live throwaway test DB. Restoring it over itself is a no-op."""
    return (_data_dir() / "openmemo.db").read_bytes()


def _make_zip(scope: str = "structure") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("backup_meta.json", json.dumps({"scope": scope, "app_version": "test"}))
        zf.writestr("openmemo.db", _current_db_bytes())
    return buf.getvalue()


def _pre_restore_copies() -> list[Path]:
    root = _data_dir() / "pre-restore"
    if not root.is_dir():
        return []
    return sorted(root.glob("*/openmemo.db.gz"))


# --------------------------------------------------------------- the .gz path


def test_restore_accepts_a_gzipped_database(client):
    """The shape the scheduled job and the Mac app actually write."""
    payload = gzip.compress(_current_db_bytes())

    resp = client.post(
        "/api/backup/restore", files={"file": ("openmemo-20260818-120000.db.gz", payload)}
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    # No metadata to read, and a bare database never carries media, so it
    # restores as a structure archive.
    assert body["scope"] == "structure"


def test_gzip_that_is_not_a_database_is_refused(client):
    """Valid gzip, wrong contents. Must not reach the live database."""
    before = _current_db_bytes()

    resp = client.post(
        "/api/backup/restore", files={"file": ("nope.db.gz", gzip.compress(b"not a database"))}
    )

    assert resp.status_code == 400
    assert _current_db_bytes() == before


def test_corrupt_gzip_is_refused(client):
    before = _current_db_bytes()

    resp = client.post(
        "/api/backup/restore", files={"file": ("truncated.db.gz", b"\x1f\x8b" + b"\x00" * 40)}
    )

    assert resp.status_code == 400
    assert _current_db_bytes() == before


def test_something_that_is_neither_is_still_refused(client):
    resp = client.post("/api/backup/restore", files={"file": ("random.bin", b"just some bytes")})
    assert resp.status_code == 400


def test_inspect_understands_a_gzipped_snapshot(client):
    """The confirmation dialog reads this. It must not claim there is no
    database in a file that is nothing but a database."""
    payload = gzip.compress(_current_db_bytes())

    resp = client.post("/api/backup/inspect", files={"file": ("snap.db.gz", payload)})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["has_database"] is True
    assert body["will_replace_database"] is True
    # Nothing is displaced: a bare database carries no media.
    assert body["will_move_aside"] == 0


# ------------------------------------------------ keeping what we overwrite


def test_restore_saves_the_database_it_replaces(client):
    before = _current_db_bytes()
    existing = len(_pre_restore_copies())

    resp = client.post("/api/backup/restore", files={"file": ("backup.zip", _make_zip())})
    assert resp.status_code == 200, resp.text

    copies = _pre_restore_copies()
    assert len(copies) == existing + 1, "restore must keep a copy of the database it overwrites"

    # And it has to be the real thing, not an empty file wearing the name.
    recovered = gzip.decompress(copies[-1].read_bytes())
    assert recovered[:16] == b"SQLite format 3\x00"
    assert len(recovered) > 0
    assert resp.json()["previous_database"] is not None
    # The bytes restored were the same database, so what we kept matches.
    assert len(recovered) >= len(before) - 65536


def test_a_gz_restore_also_keeps_a_copy(client):
    """The cheaper-looking path must not be the one that skips the safety net."""
    existing = len(_pre_restore_copies())

    resp = client.post(
        "/api/backup/restore", files={"file": ("snap.db.gz", gzip.compress(_current_db_bytes()))}
    )

    assert resp.status_code == 200, resp.text
    assert len(_pre_restore_copies()) == existing + 1


def test_the_kept_copy_is_not_swept_by_the_daily_rotation():
    """A safety copy a routine can delete on a schedule is not a safety copy."""
    from backend.core.autobackup import backup_dir, prune

    # The rotation only ever looks in backups/, and only at its own names.
    kept = _pre_restore_copies()
    assert all(backup_dir() not in p.parents for p in kept)

    prune(keep=0)  # the most aggressive sweep the rotation can perform
    assert _pre_restore_copies() == kept


# ------------------------------------------------- restoring one from disk


def test_auto_snapshot_can_be_restored_without_a_file_upload(client):
    """These live on this machine. Making people export and re-upload them is
    the reason they went unused."""
    from backend.core.autobackup import create_snapshot

    snap = create_snapshot()
    assert snap is not None and snap.is_file()

    resp = client.post("/api/backup/auto/restore", params={"name": snap.name})

    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True


@pytest.mark.parametrize(
    "name",
    [
        "../../../../etc/passwd",
        "..\\..\\openmemo.db",
        "openmemo.db",
        "does-not-exist.db.gz",
        "",
    ],
)
def test_auto_restore_only_accepts_a_real_snapshot(client, name):
    """The name comes from the client, so it is matched against the directory
    listing rather than joined onto a path."""
    before = _current_db_bytes()

    resp = client.post("/api/backup/auto/restore", params={"name": name})

    assert resp.status_code in (400, 404, 422)
    assert _current_db_bytes() == before


def test_auto_snapshot_does_not_rewrite_the_live_database():
    """The snapshot reads. Opening the source read-write would checkpoint the
    WAL and rewrite the file it is meant to be copying, while the app is
    serving requests against it."""
    from backend.core.autobackup import create_snapshot

    db = _data_dir() / "openmemo.db"
    before = db.read_bytes()

    snap = create_snapshot()

    assert snap is not None
    assert db.read_bytes() == before


def test_two_restores_in_the_same_second_keep_two_copies(client):
    """The folder name is per second. Two restores inside one second used to
    share it, and the second quietly overwrote the first one's safety copy."""
    existing = len(_pre_restore_copies())

    for _ in range(2):
        resp = client.post("/api/backup/restore", files={"file": ("backup.zip", _make_zip())})
        assert resp.status_code == 200, resp.text

    assert len(_pre_restore_copies()) == existing + 2
