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


def _hide_memo(client: TestClient, memo_id: str) -> None:
    r = client.put(f"/api/memos/{memo_id}/hide", json={"hidden": True})
    assert r.status_code == 200, r.text


def _create_collection(client: TestClient, name: str, workspace_id: str | None = None) -> str:
    body = {"name": name}
    if workspace_id:
        body["workspace_id"] = workspace_id
    r = client.post("/api/collections", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


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


def test_space_cover_upload_serve_delete(client):
    space_id = _create_space(client, "Cover Space")
    # A 1x1 PNG is enough to exercise validation + storage + serving.
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415408d763f8cfc0f01f00050001ff a5 9a 9c"  # noqa: E501
        .replace(" ", "")
        + "0000000049454e44ae426082"
    )
    up = client.post(f"/api/spaces/{space_id}/cover", files={"file": ("c.png", png, "image/png")})
    assert up.status_code == 200, up.text
    assert up.json()["cover_url"]

    got = client.get(f"/api/spaces/{space_id}/cover")
    assert got.status_code == 200
    assert got.headers["content-type"].startswith("image/")

    # A non-image is refused.
    bad = client.post(f"/api/spaces/{space_id}/cover", files={"file": ("x.txt", b"nope", "text/plain")})
    assert bad.status_code == 400

    rm = client.delete(f"/api/spaces/{space_id}/cover")
    assert rm.status_code == 200
    assert rm.json()["cover_url"] is None
    assert client.get(f"/api/spaces/{space_id}/cover").status_code == 404


def test_space_export_returns_a_zip(client):
    space_id = _create_space(client, "Exportable")
    _create_memo(client, "note to back up", workspace_id=space_id)
    r = client.get(f"/api/spaces/{space_id}/export")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert r.content[:2] == b"PK"  # zip magic


def test_hidden_memo_inside_a_space_stays_isolated(client):
    """Phase 5 (ADR-020): hidden composes with isolation. A Space's hidden Memo
    must be (1) absent from the library hidden list, (2) absent from the Space
    home, (3) present in the Space's own hidden list, (4) present when its
    collection is opened. The one global passcode is orthogonal to all of this.
    """
    space_id = _create_space(client, "Hidden Garden")

    # A hidden Memo inside the Space, filed into a Space collection.
    space_coll = _create_collection(client, "tucked shelf", workspace_id=space_id)
    space_hidden = _create_memo(client, "space secret", workspace_id=space_id)
    client.post(f"/api/collections/{space_coll}/memos/{space_hidden}")
    _hide_memo(client, space_hidden)

    # A hidden Memo in the library, to prove isolation runs both ways.
    lib_hidden = _create_memo(client, "library secret")
    _hide_memo(client, lib_hidden)

    # (1) The library hidden list (no workspace_id) holds only the library's
    # hidden Memo — the Space's hidden Memo never leaks in.
    lib_hidden_ids = _listed_ids(client, hidden=True, limit=200)
    assert lib_hidden in lib_hidden_ids
    assert space_hidden not in lib_hidden_ids

    # (2) The Space home (workspace_id, no hidden, no collection_id) excludes the
    # hidden Memo, exactly like the main dashboard.
    space_home_ids = _listed_ids(client, workspace_id=space_id, limit=200)
    assert space_hidden not in space_home_ids

    # (3) The Space's own hidden list (hidden + workspace_id) returns it, and the
    # library's hidden Memo never leaks the other way.
    space_hidden_ids = _listed_ids(client, hidden=True, workspace_id=space_id, limit=200)
    assert space_hidden in space_hidden_ids
    assert lib_hidden not in space_hidden_ids

    # (4) Opening the Space collection lifts the hidden filter (collection_id
    # present), so the hidden Memo shows there.
    coll_ids = _listed_ids(client, workspace_id=space_id, collection_id=space_coll, limit=200)
    assert space_hidden in coll_ids
