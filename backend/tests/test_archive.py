"""Scheduled archives: one verified file per run.

openMemo could already build a backup zip, but only as a browser download — so
a backup existed only if someone remembered to click, and on 2026-08-04 nobody
had. These tests pin the three rules that came out of that: an archive is
opened again and checked before it counts, an archive that would preserve an
empty media directory is refused, and neither failure is allowed to age out a
good archive.
"""
import sqlite3
import uuid
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.core import archive


@pytest.fixture
def client(tmp_path, monkeypatch):
    """App up, and archives written somewhere disposable.

    The destination is patched rather than configured through the settings API
    so a failing test cannot leave the suite writing zips into a real folder."""
    from backend.main import app

    dest = tmp_path / "archives"
    monkeypatch.setattr(archive, "destination", lambda: dest)
    with TestClient(app) as c:
        yield c


def _make_upload(name: str = "") -> Path:
    """A memo with a real file and NO source url — an upload, in other words."""
    memo_id = str(uuid.uuid4())
    path = Path(settings.FILES_DIR) / (name or f"{memo_id}.bin")
    path.write_bytes(b"upload bytes")

    con = sqlite3.connect(str(Path(settings.DATA_DIR) / "openmemo.db"))
    with con:
        con.execute(
            "insert into memos (id, type, title, file_path, source_url, is_deleted) "
            "values (?, 'file', ?, ?, null, 0)",
            (memo_id, f"archive {memo_id[:8]}", str(path)),
        )
    con.close()
    return path


def test_a_database_archive_is_written_and_verified(client):
    result = archive.create("database")
    assert result["ok"] is True
    assert result["verified"] is True
    assert result["memos"] >= 0
    assert Path(result["path"]).is_file()


def test_an_essential_archive_carries_the_uploads(client):
    path = _make_upload()
    result = archive.create("essential")

    assert result["ok"] is True
    with zipfile.ZipFile(result["path"]) as zf:
        names = zf.namelist()
    assert f"files/{path.name}" in names
    assert "openmemo.db" in names


def test_an_essential_archive_restores_like_a_full_one(client):
    """Restore only understands structure|full. An essential archive holds real
    media, so declaring it "structure" would unpack the files and ignore them."""
    _make_upload()
    result = archive.create("essential")

    with zipfile.ZipFile(result["path"]) as zf:
        meta = zf.read("backup_meta.json").decode()
    assert '"scope": "full"' in meta
    assert '"archive_scope": "essential"' in meta


def test_it_refuses_to_archive_an_empty_media_directory(client):
    """The shape of the incident: the database still references files, and the
    files are gone. Preserving that is not a backup, it is a snapshot of the
    damage — and writing it would rotate the last good archive out."""
    path = _make_upload()
    good = archive.create("essential")
    assert good["ok"] is True

    path.unlink()
    for stray in Path(settings.FILES_DIR).rglob("*"):
        if stray.is_file():
            stray.unlink()

    result = archive.create("essential")
    assert result["ok"] is False
    assert "found none" in result["reason"]
    # The refusal must not have taken the good archive with it.
    assert Path(good["path"]).is_file()


def test_a_corrupt_archive_fails_verification(client, tmp_path):
    broken = tmp_path / "openmemo-database-19700101-000000.zip"
    broken.write_bytes(b"this is not a zip")
    assert archive.verify(broken)["ok"] is False

    with zipfile.ZipFile(broken, "w") as zf:
        zf.writestr("backup_meta.json", "{}")
    checked = archive.verify(broken)
    assert checked["ok"] is False
    assert "no database" in checked["reason"]


def test_retention_is_per_scope(client):
    """Fourteen daily database archives must not age out the monthly full one."""
    dest = archive.destination()
    dest.mkdir(parents=True, exist_ok=True)
    for i in range(5):
        (dest / f"openmemo-database-2026080{i}-000000.zip").write_bytes(b"x")
    keeper = dest / "openmemo-full-20260801-000000.zip"
    keeper.write_bytes(b"x")

    archive.prune("database", keep=2)

    assert len(list(dest.glob("openmemo-database-*.zip"))) == 2
    assert keeper.is_file()


def test_the_api_lists_archives_and_their_destination(client):
    archive.create("database")
    body = client.get("/api/backup/archives").json()

    assert body["destination"] == str(archive.destination())
    assert any(a["scope"] == "database" for a in body["archives"])
    assert body["schedule"]["essential"]["keep"] == 4


def test_a_failed_run_is_recorded_rather_than_silently_skipped(client, monkeypatch):
    """A broken destination must not look like a schedule that has not fired."""
    monkeypatch.setattr(archive, "create", lambda scope: {
        "ok": False, "scope": scope, "reason": "destination unusable",
    })
    body = client.post("/api/backup/archives?scope=database").json()
    assert body["ok"] is False

    runs = client.get("/api/backup/archives").json()["runs"]
    assert runs["database"]["ok"] is False


def test_the_run_record_is_not_writable_through_the_settings_api(client):
    archive.create("database")
    assert "backup_runs" not in client.get("/api/settings").json()


def test_an_already_empty_scope_writes_a_degraded_archive_rather_than_failing(client):
    """When the files were gone BEFORE this feature existed, refusing forever
    would fail the scope every week and teach the user to ignore it. The
    database inside is still worth having, so it is written and flagged."""
    from backend.core.app_settings import set_backup_runs

    set_backup_runs({})                       # no run has ever carried media
    path = _make_upload()
    path.unlink()                             # referenced, missing

    result = archive.create("essential")
    assert result["ok"] is True
    assert result["degraded"] is True
    assert result["media_files"] == 0
    assert Path(result["path"]).is_file()


def test_a_run_records_itself_so_the_next_one_can_compare(client):
    """The stored record is what decides "lost" from "already gone"."""
    from backend.core.app_settings import get_backup_runs

    archive.create("database")
    assert (get_backup_runs() or {})["database"]["ok"] is True


def test_archives_carry_the_card_covers(client):
    """Restoring a full archive into an empty install left 693 broken cards,
    because thumbnails were excluded as "regenerable". Regenerating them means
    re-resolving posts over the network, one at a time, with every card broken
    until it finishes. 86 MB against a 4.5 GB archive buys a library that looks
    like one on arrival."""
    thumbs = Path(settings.FILES_DIR) / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    (thumbs / f"{uuid.uuid4()}.jpg").write_bytes(b"cover")
    _make_upload()

    result = archive.create("essential")
    assert result["ok"] is True
    assert result["thumbnails"] >= 1
    with zipfile.ZipFile(result["path"]) as zf:
        assert any(n.startswith("files/thumbs/") for n in zf.namelist())


def test_covers_do_not_count_as_media_carried(client):
    """`media_files` answers "did this run carry anything irreplaceable", which
    is what the next run reads to tell a wipe from an old gap. Counting covers
    there would answer yes forever."""
    from backend.core.app_settings import set_backup_runs

    thumbs = Path(settings.FILES_DIR) / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    (thumbs / f"{uuid.uuid4()}.jpg").write_bytes(b"cover")

    set_backup_runs({})
    _make_upload()
    # Earlier tests in this module leave their own uploads behind, and the
    # scope is library-wide: clear the media but keep the covers.
    for stray in Path(settings.FILES_DIR).rglob("*"):
        if stray.is_file() and thumbs not in stray.parents:
            stray.unlink()

    result = archive.create("essential")
    assert result["media_files"] == 0
    assert result["thumbnails"] >= 1
    assert result["degraded"] is True


def test_a_database_archive_stays_database_only(client):
    thumbs = Path(settings.FILES_DIR) / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    (thumbs / f"{uuid.uuid4()}.jpg").write_bytes(b"cover")

    result = archive.create("database")
    assert result["thumbnails"] == 0
