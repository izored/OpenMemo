"""Backup-restore safety: Zip-Slip containment (plans/002).

The restore endpoint unpacks a user-supplied zip. These tests are the
regression anchor for the traversal guard — do not weaken them: a malicious
entry must 400 BEFORE anything is deleted or written, and a benign archive
must still restore normally.
"""
import io
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _current_db_bytes() -> bytes:
    """The live (throwaway) test DB — restoring it back is a no-op for state."""
    from backend.config import settings

    return (Path(settings.DATA_DIR) / "openmemo.db").read_bytes()


def test_malicious_entry_rejected_and_nothing_written(client):
    from backend.config import settings

    files_dir = Path(settings.FILES_DIR)
    files_dir.mkdir(parents=True, exist_ok=True)
    sentinel = files_dir / "keep-me.txt"
    sentinel.write_text("still here")

    payload = _make_zip({
        "backup_meta.json": b'{"scope": "full"}',
        "openmemo.db": _current_db_bytes(),
        "files/../escape.txt": b"pwned",
    })
    resp = client.post(
        "/api/backup/restore",
        files={"file": ("evil.zip", payload, "application/zip")},
    )
    assert resp.status_code == 400

    escape_target = (files_dir / ".." / "escape.txt").resolve()
    assert not escape_target.exists()
    # Validation must run before the wipe: rejecting the archive must not
    # have destroyed the existing files directory.
    assert sentinel.exists()


def test_benign_full_restore_lands_inside_files_dir(client):
    from backend.config import settings

    payload = _make_zip({
        "backup_meta.json": b'{"scope": "full"}',
        "openmemo.db": _current_db_bytes(),
        "files/sub/ok.txt": b"hello",
    })
    resp = client.post(
        "/api/backup/restore",
        files={"file": ("good.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200

    restored = Path(settings.FILES_DIR) / "sub" / "ok.txt"
    assert restored.read_bytes() == b"hello"


def test_non_sqlite_db_rejected(client):
    payload = _make_zip({
        "backup_meta.json": b'{"scope": "structure"}',
        "openmemo.db": b"definitely not sqlite",
    })
    resp = client.post(
        "/api/backup/restore",
        files={"file": ("bad-db.zip", payload, "application/zip")},
    )
    assert resp.status_code == 400


# --- Non-destructive restore (2026-08-04 media loss follow-up) ---------------


def test_full_archive_with_no_media_does_not_clear_media(client):
    """An archive that carries no files cannot be a reason to delete files.

    This is the exact shape that destroyed a live library: scope said "full",
    the archive held only a database, and the endpoint cleared the media
    directory anyway before unpacking nothing into it.
    """
    from backend.config import settings

    files_dir = Path(settings.FILES_DIR)
    (files_dir / "default").mkdir(parents=True, exist_ok=True)
    keep = files_dir / "default" / "precious.mp4"
    keep.write_bytes(b"irreplaceable")

    payload = _make_zip({
        "backup_meta.json": b'{"scope": "full"}',
        "openmemo.db": _current_db_bytes(),
    })
    resp = client.post(
        "/api/backup/restore",
        files={"file": ("db-only.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200
    assert keep.read_bytes() == b"irreplaceable"
    assert resp.json()["quarantine"] is None


def test_replaced_media_is_moved_aside_not_deleted(client):
    """A real full restore must be undoable. The previous media is moved into
    data/pre-restore/<stamp>/ rather than destroyed."""
    from backend.config import settings

    files_dir = Path(settings.FILES_DIR)
    (files_dir / "default").mkdir(parents=True, exist_ok=True)
    old = files_dir / "default" / "old.mp4"
    old.write_bytes(b"the old library")

    payload = _make_zip({
        "backup_meta.json": b'{"scope": "full"}',
        "openmemo.db": _current_db_bytes(),
        "files/default/new.mp4": b"the restored library",
    })
    resp = client.post(
        "/api/backup/restore",
        files={"file": ("full.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200

    # The archive's content landed...
    assert (files_dir / "default" / "new.mp4").read_bytes() == b"the restored library"
    # ...and the previous library still exists somewhere.
    quarantine = resp.json()["quarantine"]
    assert quarantine, "a destructive restore must report where the old files went"
    recovered = Path(quarantine) / "default" / "old.mp4"
    assert recovered.read_bytes() == b"the old library"


def test_inspect_reports_without_changing_anything(client):
    from backend.config import settings

    files_dir = Path(settings.FILES_DIR)
    (files_dir / "default").mkdir(parents=True, exist_ok=True)
    sentinel = files_dir / "default" / "untouched.mp4"
    sentinel.write_bytes(b"still here")

    payload = _make_zip({
        "backup_meta.json": b'{"scope": "full", "created_at": "2026-01-01T00:00:00Z"}',
        "openmemo.db": _current_db_bytes(),
        "files/default/a.mp4": b"x",
        "files/default/b.mp4": b"y",
    })
    resp = client.post(
        "/api/backup/inspect",
        files={"file": ("preview.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["scope"] == "full"
    assert body["media_in_archive"] == 2
    assert body["will_replace_database"] is True
    assert body["will_move_aside"] >= 1
    # Nothing happened.
    assert sentinel.read_bytes() == b"still here"
