"""Clean-feed rule (OPNMMO-0023): playlist tracks live inside their playlist
only. Every list surface without an explicit collection_id must exclude them,
including the Music page library (audio_kind=music)."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.config import settings


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _set_audio_kind(memo_id: str, kind: str = "music"):
    # MemoCreate has no audio_kind field (only ingest/upload set it), so flip
    # the column directly on the test DB.
    db_path = settings.DATABASE_URL.split("///", 1)[1]
    con = sqlite3.connect(db_path)
    con.execute("UPDATE memos SET audio_kind = ? WHERE id = ?", (kind, memo_id))
    con.commit()
    con.close()


def _create_audio_memo(client: TestClient, title: str) -> str:
    r = client.post("/api/memos", json={"type": "audio", "title": title})
    assert r.status_code == 200
    memo_id = r.json()["id"]
    _set_audio_kind(memo_id)
    return memo_id


def _listed_ids(client: TestClient, **params) -> set[str]:
    r = client.get("/api/memos", params=params)
    assert r.status_code == 200
    return {m["id"] for m in r.json()["items"]}


def test_playlist_tracks_excluded_from_music_library(client):
    standalone = _create_audio_memo(client, "standalone track")
    member = _create_audio_memo(client, "playlist track")

    r = client.post(
        "/api/collections", json={"name": "test playlist", "kind": "playlist"}
    )
    assert r.status_code == 200
    playlist_id = r.json()["id"]
    assert client.post(f"/api/collections/{playlist_id}/memos/{member}").status_code == 200

    # Music page library (audio_kind=music, no collection): standalone only.
    ids = _listed_ids(client, type="audio", audio_kind="music")
    assert standalone in ids
    assert member not in ids

    # Main feed (no filters): the playlist track stays out too.
    ids = _listed_ids(client, limit=200)
    assert member not in ids

    # Playlist view (explicit collection_id): the track shows.
    ids = _listed_ids(client, type="audio", collection_id=playlist_id)
    assert member in ids


def test_standard_collection_does_not_hide_memos(client):
    memo = _create_audio_memo(client, "track in a standard collection")
    r = client.post(
        "/api/collections", json={"name": "regular shelf", "kind": "standard"}
    )
    assert r.status_code == 200
    assert client.post(f"/api/collections/{r.json()['id']}/memos/{memo}").status_code == 200

    # Only playlist-kind membership hides a memo from the feeds.
    ids = _listed_ids(client, type="audio", audio_kind="music")
    assert memo in ids
