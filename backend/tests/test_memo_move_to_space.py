"""Filing a memo into a Space is a MOVE, and it goes both ways.

A Space is a Workspace, not a label (ADR-020): memos are isolated by
`workspace_id`, so there is no version of "add this memo to a Space" that leaves
it on the dashboard too. Until this endpoint there was no way at all to get an
existing memo into a Space — memos could only ever be created inside one.

The behaviour that matters here is the part a user would only discover by losing
something: the memo leaves the library, its library collection memberships go
with it, and the same call brings it home again.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


def _space(client: TestClient, name: str) -> str:
    r = client.post("/api/spaces", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _collection(client: TestClient, name: str, workspace_id: str | None = None) -> str:
    body: dict = {"name": name}
    if workspace_id:
        body["workspace_id"] = workspace_id
    r = client.post("/api/collections", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _memo(client: TestClient, title: str, *collection_ids: str) -> str:
    r = client.post("/api/memos", json={"type": "note", "title": title})
    assert r.status_code == 200, r.text
    memo_id = r.json()["id"]
    for cid in collection_ids:
        assert client.post(f"/api/collections/{cid}/memos/{memo_id}").status_code == 200
    return memo_id


def _move(client: TestClient, memo_id: str, **body):
    return client.post(f"/api/memos/{memo_id}/move", json=body)


def _titles(client: TestClient, **params) -> set[str]:
    r = client.get("/api/memos", params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return {m["title"] for m in r.json()["items"]}


def _collection_memo_ids(
    client: TestClient, collection_id: str, workspace_id: str | None = None
) -> set[str]:
    """Memo ids in a collection. `workspace_id` is not optional in spirit: the
    listing scopes to the library unless told otherwise (ADR-020), so asking for
    a Space collection without it always answers empty."""
    params: dict = {"collection_id": collection_id, "limit": 200}
    if workspace_id:
        params["workspace_id"] = workspace_id
    r = client.get("/api/memos", params=params)
    assert r.status_code == 200, r.text
    return {m["id"] for m in r.json()["items"]}


# ------------------------------------------------------------------ the move


def test_a_memo_dropped_on_a_space_leaves_the_library(client):
    space = _space(client, "Move Space A")
    memo = _memo(client, "moves into a space")

    assert "moves into a space" in _titles(client)
    r = _move(client, memo, workspace_id=space)
    assert r.status_code == 200, r.text
    assert r.json()["moved"] is True

    assert "moves into a space" not in _titles(client)
    assert "moves into a space" in _titles(client, workspace_id=space)


def test_the_same_call_brings_it_home(client):
    """Reversibility is the whole reason this is one endpoint in both
    directions. A move you cannot undo is a delete with extra steps."""
    space = _space(client, "Move Space B")
    memo = _memo(client, "round trip")

    assert _move(client, memo, workspace_id=space).status_code == 200
    assert "round trip" not in _titles(client)

    r = _move(client, memo, workspace_id=None)
    assert r.status_code == 200, r.text
    assert "round trip" in _titles(client)


def test_dropping_on_a_space_collection_files_it_there(client):
    space = _space(client, "Move Space C")
    coll = _collection(client, "Inbox", workspace_id=space)
    memo = _memo(client, "lands in a space collection")

    r = _move(client, memo, workspace_id=space, collection_id=coll)
    assert r.status_code == 200, r.text
    assert r.json()["collection_id"] == coll
    assert memo in _collection_memo_ids(client, coll, workspace_id=space)


def test_library_memberships_do_not_follow_it_into_a_space(client):
    """A collection lives in exactly one workspace. Keeping the row would leave
    a Space memo listed inside a library collection that can never show it."""
    space = _space(client, "Move Space D")
    lib_coll = _collection(client, "Library bucket")
    memo = _memo(client, "sheds its old collection", lib_coll)

    assert memo in _collection_memo_ids(client, lib_coll)
    assert _move(client, memo, workspace_id=space).status_code == 200
    # Bring it home before asserting: while it lives in the Space the library
    # listing hides it either way, so checking there would pass for the wrong
    # reason. Back in the library, the dropped membership is the only thing
    # that can still explain its absence from the collection.
    assert _move(client, memo, workspace_id=None).status_code == 200
    assert "sheds its old collection" in _titles(client)
    assert memo not in _collection_memo_ids(client, lib_coll)


def test_a_collection_from_another_workspace_is_refused(client):
    """Landing a memo in a Space while pointing it at a library collection would
    file it somewhere that cannot list it. Better a 400 than a silent orphan."""
    space = _space(client, "Move Space E")
    lib_coll = _collection(client, "Not in the space")
    memo = _memo(client, "mismatched target")

    r = _move(client, memo, workspace_id=space, collection_id=lib_coll)
    assert r.status_code == 400
    assert "not in the destination" in r.json()["detail"].lower()


def test_an_unknown_space_is_a_404(client):
    memo = _memo(client, "nowhere to go")
    r = _move(client, memo, workspace_id="no-such-space")
    assert r.status_code == 404


def test_an_unknown_memo_is_a_404(client):
    space = _space(client, "Move Space F")
    r = _move(client, "no-such-memo", workspace_id=space)
    assert r.status_code == 404


def test_moving_to_where_it_already_is_reports_no_move(client):
    memo = _memo(client, "already home")
    r = _move(client, memo, workspace_id=None)
    assert r.status_code == 200
    assert r.json()["moved"] is False


def test_a_collection_can_be_joined_without_moving_workspace(client):
    """Same endpoint, no workspace change: the memo stays in the library and
    just joins a library collection."""
    coll = _collection(client, "Stay home")
    memo = _memo(client, "joins in place")

    r = _move(client, memo, collection_id=coll)
    assert r.status_code == 200, r.text
    assert r.json()["moved"] is False
    assert memo in _collection_memo_ids(client, coll)
    assert "joins in place" in _titles(client)


def test_moving_twice_does_not_duplicate_the_membership(client):
    space = _space(client, "Move Space G")
    coll = _collection(client, "Twice", workspace_id=space)
    memo = _memo(client, "idempotent")

    assert _move(client, memo, workspace_id=space, collection_id=coll).status_code == 200
    assert _move(client, memo, workspace_id=space, collection_id=coll).status_code == 200
    assert _collection_memo_ids(client, coll, workspace_id=space) == {memo}


# --------------------------------------------------------------- the media file


def test_the_media_file_follows_the_memo_into_the_space(client, tmp_path):
    """Media is stored per workspace; deleting a Space deletes its memos by
    `workspace_id` and never touches files. A memo filed into a Space while its
    bytes stayed in the library folder would leave an orphan nothing accounts
    for."""
    from pathlib import Path

    from backend.api.memos import _relocate_media
    from backend.config import settings

    space = "space-relocate"
    src_dir = Path(settings.FILES_DIR) / "default"
    src_dir.mkdir(parents=True, exist_ok=True)
    src = src_dir / "relocate-me.bin"
    src.write_bytes(b"payload")

    class _M:
        id = "m1"
        file_path = "files/default/relocate-me.bin"

    memo = _M()
    _relocate_media(memo, space)

    assert memo.file_path == f"files/{space}/relocate-me.bin"
    assert (Path(settings.FILES_DIR) / space / "relocate-me.bin").read_bytes() == b"payload"
    assert not src.exists()


def test_a_missing_file_is_not_an_error(client):
    """Every failure in the relocate is swallowed: a memo that moved but kept
    its old path is correct and playable, which beats a half-failed move."""
    from backend.api.memos import _relocate_media

    class _M:
        id = "m2"
        file_path = "files/default/never-existed.bin"

    memo = _M()
    _relocate_media(memo, "space-x")
    assert memo.file_path == "files/default/never-existed.bin"
