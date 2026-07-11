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
