"""Duplicate playlist guard: pasting an already-pulled playlist URL returns
the existing collection (status 'exists') instead of minting a duplicate.
The check runs before the yt-dlp probe, so this needs no network."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def test_reingesting_same_playlist_url_returns_existing(client):
    url = "https://www.youtube.com/playlist?list=PLTESTDEDUPE001"
    r = client.post(
        "/api/collections",
        json={"name": "already pulled", "kind": "playlist", "source_url": url},
    )
    assert r.status_code == 200
    existing_id = r.json()["id"]

    r = client.post("/api/ingest/playlist", json={"url": url})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "exists"
    assert body["collection_id"] == existing_id
