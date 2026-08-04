"""Library integrity check.

The 2026-08-04 wipe was invisible for ninety minutes: cards still rendered from
cached thumbnails and nothing in the app ever asked whether the files behind
them were still there. These tests pin the behaviour that fixes that, and in
particular the one distinction that makes the alert worth reading — a gap that
has been there since the last check is a known state, a gap that just appeared
is an incident.
"""
import sqlite3
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.core import integrity


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _make_memo(*, source_url: str = "") -> tuple[str, Path]:
    """A memo whose media file really exists in the throwaway FILES_DIR.

    Inserted directly: the create endpoint deliberately has no `file_path`
    field (paths come from ingest, never from a caller), and what is under test
    here is the relationship between a stored path and the disk."""
    memo_id = str(uuid.uuid4())
    path = Path(settings.FILES_DIR) / f"{memo_id}.bin"
    path.write_bytes(b"x")

    con = sqlite3.connect(str(Path(settings.DATA_DIR) / "openmemo.db"))
    with con:
        con.execute(
            "insert into memos (id, type, title, file_path, source_url, is_deleted) "
            "values (?, 'file', ?, ?, ?, 0)",
            (memo_id, f"integrity {memo_id[:8]}", str(path), source_url or None),
        )
    con.close()
    return memo_id, path


def _check(client) -> dict:
    return client.post("/api/settings/library/integrity/check").json()


def test_adding_a_memo_whose_file_exists_changes_nothing(client):
    # Counts are compared against a baseline rather than asserted absolutely:
    # the suite shares one throwaway database, so another module may well have
    # left memos in it. What matters is the change this test causes.
    before = _check(client)
    _make_memo()
    after = _check(client)

    assert after["missing_media"] == before["missing_media"]
    assert after["with_media"] == before["with_media"] + 1
    assert after["status"] != "incident"


def test_a_deleted_file_is_counted_and_classified(client):
    _, keeps = _make_memo()
    _, gone_with_source = _make_memo(source_url="https://example.com/x")
    _, gone_upload = _make_memo()
    before = _check(client)

    gone_with_source.unlink()
    gone_upload.unlink()
    after = _check(client)

    assert after["missing_media"] == before["missing_media"] + 2
    # The split is the actionable part: one can be re-downloaded, one cannot.
    assert after["recoverable"] == before["recoverable"] + 1
    assert after["unrecoverable"] == before["unrecoverable"] + 1
    assert keeps.exists()


def test_a_new_gap_is_an_incident_and_a_known_one_is_not(client):
    _, path = _make_memo()
    _check(client)

    path.unlink()
    first = _check(client)
    assert first["status"] == "incident"
    assert first["delta"] == 1

    # Nothing further has been lost. The same gap must not keep crying wolf, or
    # the alert stops meaning anything and the next real one is ignored.
    second = _check(client)
    assert second["status"] == "missing"
    assert second["delta"] == 0


def test_the_first_run_ever_never_reports_an_incident(client):
    """A library that already has gaps when the check first ships is not news.

    Otherwise every existing install would open Settings to a red alert about a
    loss that happened months ago, which is how people learn to ignore alerts."""
    _, path = _make_memo()
    path.unlink()

    result = integrity._verdict(
        {"missing_media": 1, "missing_thumbs": 0}, None
    )
    assert result == ("missing", 0)


def test_the_check_is_readable_without_having_run_one(client):
    """GET answers with a real result on a fresh install rather than a null."""
    result = client.get("/api/settings/library/integrity").json()
    assert result["status"] in ("ok", "missing", "incident")
    assert "checked_at" in result


def test_the_result_is_not_writable_through_the_settings_api(client):
    """It is a health record, not a preference. A settings PUT must not forge it."""
    client.post("/api/settings/library/integrity/check")
    assert "library_integrity" not in client.get("/api/settings").json()


def test_thumbnails_resolve_through_their_own_url_shape(client):
    """`/api/files/thumb/x` lives at `files/thumbs/x` — singular in the route,
    plural on disk. Resolving it like a media path finds nothing, which reported
    every thumbnail in a real 693-memo library as missing."""
    from backend.core.file_paths import resolve_thumbnail_path

    thumbs = Path(settings.FILES_DIR) / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4()}.jpg"
    (thumbs / name).write_bytes(b"jpeg-ish")

    assert resolve_thumbnail_path(f"/api/files/thumb/{name}") is not None
    assert resolve_thumbnail_path("/api/files/thumb/does-not-exist.jpg") is None


def test_a_memo_thumbnail_that_exists_is_not_counted_missing(client):
    thumbs = Path(settings.FILES_DIR) / "thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    memo_id = str(uuid.uuid4())
    (thumbs / f"{memo_id}.jpg").write_bytes(b"jpeg-ish")

    con = sqlite3.connect(str(Path(settings.DATA_DIR) / "openmemo.db"))
    with con:
        con.execute(
            "insert into memos (id, type, title, thumbnail_path, is_deleted) "
            "values (?, 'link', 'thumb test', ?, 0)",
            (memo_id, f"/api/files/thumb/{memo_id}.jpg"),
        )
    con.close()

    before = _check(client)
    after = _check(client)
    assert after["with_thumb"] >= 1
    assert after["missing_thumbs"] == before["missing_thumbs"]
