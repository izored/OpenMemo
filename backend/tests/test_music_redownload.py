"""Re-downloading a playlist whose files are gone (or that you just want again).

Two holes this covers, both hit after a data loss where the DB kept every row
but the files directory came back empty:

  1. A memo still carrying a `file_path` whose file is missing looked
     downloaded — it counted as `done` in the playlist progress and the Music
     page offered no way to pull it back.
  2. "Download all" only ever queued tracks with a NULL `file_path`, so those
     rows were skipped forever. There was no way to re-pull a whole album.

Job workers are disabled in the suite (conftest), so nothing actually
downloads: the assertions are about which tracks get selected and what the DB
looks like right after.
"""
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _db_exec(sql: str, *params, expect_rows: int | None = None):
    """Write straight to the test DB — the API exposes neither file_path nor
    localize_status. Retries because the app holds the same WAL database open."""
    db_path = settings.DATABASE_URL.split("///", 1)[1]
    last_error: Exception | None = None
    for attempt in range(10):
        con = sqlite3.connect(db_path, timeout=5.0)
        try:
            con.execute("PRAGMA busy_timeout=5000")
            cur = con.execute(sql, params)
            con.commit()
            if expect_rows is None or cur.rowcount == expect_rows:
                return
            last_error = AssertionError(
                f"expected {expect_rows} row(s) affected, got {cur.rowcount}: {sql}"
            )
        except sqlite3.OperationalError as exc:  # locked/busy under contention
            last_error = exc
        finally:
            con.close()
        time.sleep(0.05 * (attempt + 1))
    raise AssertionError(f"_db_exec never applied after retries: {last_error}")


def _row(memo_id: str) -> tuple:
    db_path = settings.DATABASE_URL.split("///", 1)[1]
    con = sqlite3.connect(db_path, timeout=5.0)
    try:
        return con.execute(
            "SELECT file_path, localize_status FROM memos WHERE id = ?", (memo_id,)
        ).fetchone()
    finally:
        con.close()


def _track(client: TestClient, playlist_id: str, title: str, *, file_path: str | None) -> str:
    """A music track in `playlist_id`, optionally claiming a local file."""
    r = client.post(
        "/api/memos",
        json={
            "type": "audio",
            "title": title,
            "source_url": f"https://music.example.com/track/{title.replace(' ', '-')}",
        },
    )
    assert r.status_code == 200
    memo_id = r.json()["id"]
    _db_exec(
        "UPDATE memos SET audio_kind = 'music', file_path = ? WHERE id = ?",
        file_path,
        memo_id,
        expect_rows=1,
    )
    assert client.post(f"/api/collections/{playlist_id}/memos/{memo_id}").status_code == 200
    return memo_id


def _playlist(client: TestClient, name: str) -> str:
    r = client.post("/api/collections", json={"name": name, "kind": "playlist"})
    assert r.status_code == 200
    return r.json()["id"]


def _progress(client: TestClient, playlist_id: str) -> dict:
    r = client.get("/api/music/playlists")
    assert r.status_code == 200
    entry = next(p for p in r.json() if p["id"] == playlist_id)
    return entry["progress"]


def _real_file(name: str) -> str:
    """An actual file under the throwaway FILES_DIR, so it resolves on disk."""
    p = Path(settings.FILES_DIR) / "default" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"not really audio, but it exists")
    return str(p)


def test_missing_file_is_not_counted_as_downloaded(client):
    playlist_id = _playlist(client, "wiped album")
    _track(client, playlist_id, "gone track", file_path=_real_file("here.m4a") + ".nope")
    _track(client, playlist_id, "kept track", file_path=_real_file("kept.m4a"))

    progress = _progress(client, playlist_id)
    assert progress["total"] == 2
    assert progress["done"] == 1
    assert progress["missing"] == 1


def test_download_all_picks_up_tracks_whose_file_vanished(client):
    playlist_id = _playlist(client, "recoverable album")
    gone = _track(client, playlist_id, "gone track", file_path="/nowhere/at/all.m4a")
    kept = _track(client, playlist_id, "kept track", file_path=_real_file("still-here.m4a"))

    r = client.post(f"/api/music/playlists/{playlist_id}/download")
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "missing"
    assert body["queued"] == 1

    # The stale path is dropped so the track reads as remote while it re-pulls.
    assert _row(gone) == (None, "pending")
    # The one that is really on disk is left completely alone.
    file_path, status = _row(kept)
    assert file_path is not None and status is None


def test_scope_all_requeues_every_track_including_local_ones(client):
    playlist_id = _playlist(client, "full re-pull")
    local = _track(client, playlist_id, "local track", file_path=_real_file("local.m4a"))
    remote = _track(client, playlist_id, "remote track", file_path=None)

    r = client.post(f"/api/music/playlists/{playlist_id}/download", params={"scope": "all"})
    assert r.status_code == 200
    assert r.json()["queued"] == 2

    # The local track keeps its file — it stays playable until the new one
    # lands — but it IS queued, which the default scope would never do.
    file_path, status = _row(local)
    assert file_path is not None and status == "pending"
    assert _row(remote) == (None, "pending")

    # A track being re-pulled reads as pending, not as already done.
    progress = _progress(client, playlist_id)
    assert progress["pending"] == 2
    assert progress["done"] == 0


def test_unknown_scope_is_rejected(client):
    playlist_id = _playlist(client, "bad scope")
    r = client.post(f"/api/music/playlists/{playlist_id}/download", params={"scope": "everything"})
    assert r.status_code == 400
