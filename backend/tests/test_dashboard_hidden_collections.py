"""Hide-from-dashboard collections (OPNMMO-0053).

A collection marked `hidden_from_dashboard` keeps its memos out of the All-Memos
feed and its type tabs. It is a decluttering switch for a noisy bucket (a
shopping wishlist, a research dump), NOT a second privacy gate: the collection
stays listed, opening it still shows everything, and `Memo.hidden` remains the
passcode-gated one.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _collection(client: TestClient, name: str, hidden: bool) -> str:
    r = client.post(
        "/api/collections",
        json={"name": name, "hidden_from_dashboard": hidden},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _memo_in(client: TestClient, title: str, *collection_ids: str) -> str:
    r = client.post("/api/memos", json={"type": "note", "title": title})
    assert r.status_code == 200, r.text
    memo_id = r.json()["id"]
    for cid in collection_ids:
        assert client.post(f"/api/collections/{cid}/memos/{memo_id}").status_code == 200
    return memo_id


def _feed_titles(client: TestClient, **params) -> set[str]:
    r = client.get("/api/memos", params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return {m["title"] for m in r.json()["items"]}


def test_hidden_collection_memos_leave_the_dashboard_feed(client):
    noisy = _collection(client, "Temu wishlist", hidden=True)
    normal = _collection(client, "Reading", hidden=False)
    _memo_in(client, "cheap-gadget", noisy)
    _memo_in(client, "long-read", normal)

    titles = _feed_titles(client)
    assert "long-read" in titles
    assert "cheap-gadget" not in titles


def test_opening_the_collection_still_shows_everything(client):
    noisy = _collection(client, "Temu wishlist 2", hidden=True)
    _memo_in(client, "still-here", noisy)

    assert "still-here" in _feed_titles(client, collection_id=noisy)


def test_the_collection_itself_stays_listed(client):
    noisy = _collection(client, "Temu wishlist 3", hidden=True)

    listed = client.get("/api/collections").json()
    row = next(c for c in listed if c["id"] == noisy)
    assert row["hidden_from_dashboard"] is True


def test_membership_of_a_hidden_collection_wins(client):
    """A memo filed in BOTH a hidden and a normal collection stays hidden.

    The user asked for that bucket to be out of the way; honouring it only when
    the memo has no other home would make the switch unpredictable."""
    noisy = _collection(client, "Temu wishlist 4", hidden=True)
    normal = _collection(client, "Reading 4", hidden=False)
    _memo_in(client, "double-filed", noisy, normal)

    assert "double-filed" not in _feed_titles(client)


def test_the_switch_is_reversible(client):
    noisy = _collection(client, "Temu wishlist 5", hidden=True)
    _memo_in(client, "comes-back", noisy)
    assert "comes-back" not in _feed_titles(client)

    r = client.put(f"/api/collections/{noisy}", json={"hidden_from_dashboard": False})
    assert r.status_code == 200, r.text
    assert r.json()["hidden_from_dashboard"] is False
    assert "comes-back" in _feed_titles(client)


def test_an_ordinary_collection_is_unaffected(client):
    """The default has to stay off, or an upgrade would empty the dashboard."""
    plain = _collection(client, "Reading 6", hidden=False)
    _memo_in(client, "plainly-visible", plain)

    listed = client.get("/api/collections").json()
    row = next(c for c in listed if c["id"] == plain)
    assert row["hidden_from_dashboard"] is False
    assert "plainly-visible" in _feed_titles(client)
