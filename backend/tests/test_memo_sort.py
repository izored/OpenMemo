"""The `sort` param on GET /api/memos: recent (default) | title | artist."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def test_sort_title_is_alphabetical(client):
    # Unique prefix + the search filter keep this independent of whatever
    # other tests left in the shared test DB.
    for title in ("zsortable banana", "zsortable apple", "zsortable cherry"):
        assert client.post("/api/memos", json={"type": "note", "title": title}).status_code == 200

    r = client.get("/api/memos", params={"search": "zsortable", "sort": "title"})
    assert r.status_code == 200
    titles = [m["title"] for m in r.json()["items"]]
    assert titles == ["zsortable apple", "zsortable banana", "zsortable cherry"]

    # Default stays recency: newest creation first.
    r = client.get("/api/memos", params={"search": "zsortable"})
    assert r.json()["items"][0]["title"] == "zsortable cherry"
