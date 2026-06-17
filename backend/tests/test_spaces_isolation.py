"""Spaces isolation (ADR-020): a Space is a Workspace with kind='space'. Its
memos and collections must stay out of the main library's lists and only appear
when a surface passes the Space's workspace_id explicitly. The destructive
delete is refused unless the caller echoes the exact Space name back."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _create_space(client: TestClient, name: str) -> str:
    r = client.post("/api/spaces", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_memo(client: TestClient, title: str, workspace_id: str | None = None) -> str:
    body = {"type": "note", "title": title}
    if workspace_id:
        body["workspace_id"] = workspace_id
    r = client.post("/api/memos", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _listed_ids(client: TestClient, **params) -> set[str]:
    r = client.get("/api/memos", params=params)
    assert r.status_code == 200
    return {m["id"] for m in r.json()["items"]}


def test_space_memo_hidden_from_main_library(client):
    space_id = _create_space(client, "Side Project")
    lib_memo = _create_memo(client, "library note")
    space_memo = _create_memo(client, "space note", workspace_id=space_id)

    # Main dashboard (no workspace_id) = the library only. The Space memo must
    # not leak in; the library memo is there.
    main_ids = _listed_ids(client, limit=200)
    assert lib_memo in main_ids
    assert space_memo not in main_ids

    # Asking for the Space explicitly returns only its memos.
    space_ids = _listed_ids(client, workspace_id=space_id, limit=200)
    assert space_memo in space_ids
    assert lib_memo not in space_ids


def test_spaces_list_excludes_the_default_library(client):
    space_id = _create_space(client, "My Space")
    spaces = client.get("/api/spaces").json()
    ids = {s["id"] for s in spaces}
    assert space_id in ids
    assert "default" not in ids  # the library is never a Space


def test_collections_are_scoped_to_their_workspace(client):
    space_id = _create_space(client, "Walled Garden")
    r = client.post("/api/collections", json={"name": "space shelf", "workspace_id": space_id})
    assert r.status_code == 200
    space_coll = r.json()["id"]

    # Default collections list (library) must not show the Space's collection.
    lib_colls = {c["id"] for c in client.get("/api/collections").json()}
    assert space_coll not in lib_colls

    # Scoped to the Space, it shows.
    space_colls = {c["id"] for c in client.get("/api/collections", params={"workspace_id": space_id}).json()}
    assert space_coll in space_colls


def test_destructive_delete_requires_exact_name(client):
    space_id = _create_space(client, "Doomed Space")
    space_memo = _create_memo(client, "doomed note", workspace_id=space_id)

    # Wrong confirmation is refused, and nothing is deleted.
    bad = client.post(f"/api/spaces/{space_id}/delete", json={"confirm_name": "wrong"})
    assert bad.status_code == 400
    assert space_memo in _listed_ids(client, workspace_id=space_id, limit=200)

    # Exact name deletes the Space and its memos.
    ok = client.post(f"/api/spaces/{space_id}/delete", json={"confirm_name": "Doomed Space"})
    assert ok.status_code == 200
    assert client.get(f"/api/spaces/{space_id}").status_code == 404
    # The memo is gone from everywhere.
    assert space_memo not in _listed_ids(client, workspace_id=space_id, limit=200)


def test_space_export_returns_a_zip(client):
    space_id = _create_space(client, "Exportable")
    _create_memo(client, "note to back up", workspace_id=space_id)
    r = client.get(f"/api/spaces/{space_id}/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert r.content[:2] == b"PK"  # zip magic
