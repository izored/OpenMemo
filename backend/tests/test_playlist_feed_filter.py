"""Clean-feed rule (OPNMMO-0023): playlist-BORN tracks live inside their
playlist only. Every list surface without an explicit collection_id must
exclude them, including the Music page library (audio_kind=music). A
standalone song added to a playlist later (playlist_born=False) keeps its
library spot — Spotify model."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.config import settings


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _db_exec(sql: str, *params):
    # MemoCreate exposes neither audio_kind nor playlist_born (only ingest
    # sets them), so flip the columns directly on the test DB.
    db_path = settings.DATABASE_URL.split("///", 1)[1]
    con = sqlite3.connect(db_path)
    con.execute(sql, params)
    con.commit()
    con.close()


def _create_music_memo(client: TestClient, title: str, born: bool = False) -> str:
    r = client.post("/api/memos", json={"type": "audio", "title": title})
    assert r.status_code == 200
    memo_id = r.json()["id"]
    _db_exec(
        "UPDATE memos SET audio_kind = 'music', playlist_born = ? WHERE id = ?",
        1 if born else 0,
        memo_id,
    )
    return memo_id


def _create_collection(client: TestClient, name: str, kind: str) -> str:
    r = client.post("/api/collections", json={"name": name, "kind": kind})
    assert r.status_code == 200
    return r.json()["id"]


def _add_to_collection(client: TestClient, collection_id: str, memo_id: str):
    assert client.post(f"/api/collections/{collection_id}/memos/{memo_id}").status_code == 200


def _listed_ids(client: TestClient, **params) -> set[str]:
    r = client.get("/api/memos", params=params)
    assert r.status_code == 200
    return {m["id"] for m in r.json()["items"]}


def test_playlist_born_tracks_excluded_from_feeds(client):
    standalone = _create_music_memo(client, "standalone track")
    born = _create_music_memo(client, "playlist-born track", born=True)

    playlist_id = _create_collection(client, "test playlist", "playlist")
    _add_to_collection(client, playlist_id, born)

    # Music page library (audio_kind=music, no collection): standalone only.
    ids = _listed_ids(client, type="audio", audio_kind="music", limit=200)
    assert standalone in ids
    assert born not in ids

    # Main feed (no filters): the born track stays out too.
    ids = _listed_ids(client, limit=200)
    assert born not in ids

    # Playlist view (explicit collection_id): the track shows.
    ids = _listed_ids(client, type="audio", collection_id=playlist_id)
    assert born in ids


def test_dragged_in_track_keeps_library_spot(client):
    # A standalone song filed into a playlist by hand is NOT playlist-born:
    # it must show in the library AND inside the playlist.
    song = _create_music_memo(client, "dragged-in song", born=False)
    playlist_id = _create_collection(client, "drag target", "playlist")
    _add_to_collection(client, playlist_id, song)

    ids = _listed_ids(client, type="audio", audio_kind="music", limit=200)
    assert song in ids
    ids = _listed_ids(client, type="audio", collection_id=playlist_id)
    assert song in ids


def test_born_track_resurfaces_when_playlist_dies(client):
    # Deleting the playlist removes the membership; a born track must come
    # back to the library, not vanish forever.
    born = _create_music_memo(client, "orphaned born track", born=True)
    playlist_id = _create_collection(client, "doomed playlist", "playlist")
    _add_to_collection(client, playlist_id, born)

    assert born not in _listed_ids(client, type="audio", audio_kind="music", limit=200)
    assert client.delete(f"/api/collections/{playlist_id}").status_code == 200
    assert born in _listed_ids(client, type="audio", audio_kind="music", limit=200)


def test_standard_collection_does_not_hide_memos(client):
    # Only playlist-kind membership (plus the born flag) hides a memo. A born
    # flag alone, with membership in a standard collection only, hides nothing.
    memo = _create_music_memo(client, "track in a standard collection", born=True)
    collection_id = _create_collection(client, "regular shelf", "standard")
    _add_to_collection(client, collection_id, memo)

    ids = _listed_ids(client, type="audio", audio_kind="music", limit=200)
    assert memo in ids
