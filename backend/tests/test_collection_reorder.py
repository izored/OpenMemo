"""Drag-to-reorder for collections (sidebar + Collections page).

Ordering has exactly one mechanism here: the user drags, and that order is
written to `Collection.sort_order`. There is no sort toggle and no second
ordering rule, on purpose (see .claude/rules/openmemo-conventions.md). These
tests pin the two halves of that: a new collection lands at the END of the
list, and PUT /api/collections/reorder renumbers a whole list in one request.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _make(client: TestClient, name: str, **extra) -> str:
    r = client.post("/api/collections", json={"name": name, **extra})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _names(client: TestClient, **params) -> list[str]:
    r = client.get("/api/collections", params=params)
    assert r.status_code == 200, r.text
    return [c["name"] for c in r.json()]


def _ids(client: TestClient, **params) -> list[str]:
    r = client.get("/api/collections", params=params)
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()]


def test_new_collections_land_at_the_end(client):
    """New goes last. The old default of 0 put every fresh collection into a
    tie with the whole library, so it surfaced wherever SQLite happened to
    put it instead of at the bottom where the user just made it."""
    for n in ("alpha", "bravo", "charlie"):
        _make(client, n)

    listed = _names(client)
    assert listed.index("alpha") < listed.index("bravo") < listed.index("charlie")


def test_reorder_writes_the_dragged_order(client):
    a = _make(client, "r-one")
    b = _make(client, "r-two")
    c = _make(client, "r-three")

    current = _ids(client)
    # Drag the last one to the front, keeping every other row where it was.
    dragged = [c] + [x for x in current if x != c]

    r = client.put("/api/collections/reorder", json={"ids": dragged})
    assert r.status_code == 200, r.text
    assert r.json()["count"] == len(dragged)

    assert _ids(client) == dragged
    assert _ids(client).index(c) == 0
    assert _ids(client).index(a) < _ids(client).index(b)


def test_reorder_survives_a_relisting_and_is_absolute(client):
    """sort_order is rewritten for the whole list, so no ties are left behind
    and a second GET cannot come back in a different order."""
    ids = [_make(client, f"stable-{i}") for i in range(5)]
    flipped = list(reversed(_ids(client)))

    assert client.put("/api/collections/reorder", json={"ids": flipped}).status_code == 200

    first = _ids(client)
    second = _ids(client)
    assert first == flipped == second
    orders = [c["sort_order"] for c in client.get("/api/collections").json()]
    assert orders == sorted(orders)
    assert len(set(orders)) == len(orders), "renumbering must leave no ties"
    assert set(ids) <= set(first)


def test_pinned_collections_still_come_first(client):
    """Pinning outranks drag order: the sidebar's Pinned section is a separate
    list, and a drag in the main list must not pull a pinned row out of it."""
    _make(client, "p-plain")
    pin = _make(client, "p-pinned", pinned=True)

    # Drag the plain one to the very front of the whole list.
    plain_first = [c["id"] for c in client.get("/api/collections").json()]
    plain_first.sort(key=lambda i: i != pin)  # pinned last in the payload
    assert client.put("/api/collections/reorder", json={"ids": plain_first}).status_code == 200

    assert _ids(client)[0] == pin


def test_reorder_rejects_an_unknown_collection(client):
    _make(client, "known")
    known = _ids(client)

    r = client.put("/api/collections/reorder", json={"ids": known + ["does-not-exist"]})
    assert r.status_code == 404
    assert "does-not-exist" in r.json()["detail"]


def test_reorder_cannot_span_workspaces(client):
    """A Space is isolated (ADR-020). A library drag must never renumber the
    collections inside a Space."""
    lib = _make(client, "w-library")
    spaced = _make(client, "w-space", workspace_id="some-space")

    r = client.put("/api/collections/reorder", json={"ids": [spaced, lib]})
    assert r.status_code == 400
    assert "workspace" in r.json()["detail"].lower()


def test_reorder_of_an_empty_list_is_a_noop(client):
    r = client.put("/api/collections/reorder", json={"ids": []})
    assert r.status_code == 200
    assert r.json() == {"status": "noop", "count": 0}


def test_a_space_reorders_its_own_collections(client):
    one = _make(client, "s-one", workspace_id="space-x")
    two = _make(client, "s-two", workspace_id="space-x")

    r = client.put("/api/collections/reorder", json={"ids": [two, one]})
    assert r.status_code == 200, r.text
    assert _ids(client, workspace_id="space-x") == [two, one]
