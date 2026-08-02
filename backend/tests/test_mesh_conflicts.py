"""Resolving conflicts (ADR-024 §7).

The dialogue's contract, in the layer beneath it: keep-both never discards what
a human typed, a decision settles the disagreement for good, and the whole batch
can be answered at once.
"""
import pytest
from sqlalchemy import text

from backend.core.mesh import apply as mesh_apply
from backend.core.mesh import journal, rowstore
from backend.core.mesh.sync_state import mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db

PEER = "MacBook"
OLD = "0001700000000000-000000-aaaaaaaa"
NEW = "0001700000009000-000000-bbbbbbbb"


@pytest.fixture(autouse=True)
async def _fresh():
    await init_db()
    await mesh_schema_init()
    async with AsyncSessionLocal() as db:
        for t in ("mesh_journal", "mesh_conflicts", "mesh_base", "memos"):
            await db.execute(text(f"DELETE FROM {t}"))
        await db.commit()
    yield


async def _seed(mid="m1", **cols):
    fields = {"id": mid, "type": "note", "title": "local title"}
    fields.update(cols)
    keys = ", ".join(fields)
    binds = ", ".join(f":{k}" for k in fields)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"INSERT INTO memos ({keys}) VALUES ({binds})"), fields)
        await db.commit()


async def _make_conflict(local="mine", remote="theirs", base="shared", field="title"):
    await _seed(**{field: local})
    await rowstore.set_base("memos", "m1", {field: base}, OLD)
    await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", field: remote},
    }], peer=PEER, take_snapshot=False)
    conflicts = await mesh_apply.open_conflicts()
    assert len(conflicts) == 1, f"expected one conflict, got {conflicts}"
    return conflicts[0]


async def _title(mid="m1"):
    row = await rowstore.read_row("memos", mid)
    return row["title"] if row else None


# -- the three choices -------------------------------------------------------

async def test_keeping_the_local_value_leaves_the_row_alone():
    c = await _make_conflict()
    result = await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_LOCAL)

    assert result["ok"]
    assert await _title() == "mine"
    assert await mesh_apply.open_conflicts() == []


async def test_keeping_the_remote_value_applies_it():
    c = await _make_conflict()
    await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_REMOTE)
    assert await _title() == "theirs"


async def test_keep_both_never_discards_what_someone_typed():
    """The default in the UI, and the reason it is the default: a wrong click
    should cost a tidy-up, not somebody's writing."""
    c = await _make_conflict(local="what I wrote", remote="what they wrote")
    result = await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_BOTH)

    assert await _title() == "what they wrote"
    assert result["copy_id"], "the losing text must be preserved somewhere"

    copy = await rowstore.read_row("memos", result["copy_id"])
    assert copy is not None
    assert copy["title"].endswith(f"(from {PEER})"), "the copy must say where it came from"


# -- a decision has to stick -------------------------------------------------

async def test_a_resolved_conflict_does_not_come_back_on_the_next_sync():
    """The base must advance over a settled disagreement, or the user is asked
    the same question forever."""
    c = await _make_conflict()
    await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_REMOTE)

    again = await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "theirs"},
    }], peer=PEER, take_snapshot=False)

    assert again.conflicts == 0, "a settled disagreement must not be re-raised"
    assert await mesh_apply.open_conflicts() == []


async def test_resolving_twice_is_refused_not_repeated():
    c = await _make_conflict()
    assert (await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_LOCAL))["ok"]
    second = await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_REMOTE)
    assert not second["ok"]
    assert await _title() == "mine", "the second call must not change anything"


async def test_an_unknown_choice_is_rejected():
    c = await _make_conflict()
    with pytest.raises(ValueError):
        await mesh_apply.resolve_conflict(c["id"], "whatever-the-user-sent")


# -- the decision is recorded ------------------------------------------------

async def test_resolving_is_journalled_like_any_other_change():
    """§13: nothing Mesh writes is unexplained — including what the user chose."""
    c = await _make_conflict()
    await mesh_apply.resolve_conflict(c["id"], mesh_apply.KEEP_REMOTE)

    entries = [e for e in await journal.for_row("memos", "m1") if e.field == "title"]
    assert entries, "the resolution must appear in history"
    assert any(e.rule.startswith("user-choice") for e in entries), (
        "history must say the human decided, not that a rule did"
    )
    assert any(e.old_value == "mine" for e in entries), "undo needs the old value"


# -- batching ----------------------------------------------------------------

async def test_one_decision_can_answer_a_whole_batch():
    """Forty conflicts from a mass import is one decision, not forty modals."""
    for i in range(5):
        await _seed(f"b{i}", title="mine")
        await rowstore.set_base("memos", f"b{i}", {"title": "shared"}, OLD)
    await mesh_apply.apply_rows([
        {"tbl": "memos", "row_id": f"b{i}", "hlc": NEW,
         "values": {"id": f"b{i}", "type": "note", "title": "theirs"}}
        for i in range(5)
    ], peer=PEER, take_snapshot=False)

    assert len(await mesh_apply.open_conflicts()) == 5
    assert await mesh_apply.resolve_all(mesh_apply.KEEP_REMOTE) == 5
    assert await mesh_apply.open_conflicts() == []
    assert await _title("b3") == "theirs"


# -- the API surface ---------------------------------------------------------

async def test_conflicts_are_reachable_through_the_api_only_when_enabled():
    from fastapi.testclient import TestClient

    from backend.core.app_settings import get_settings, update_settings
    from backend.main import app

    before = bool(get_settings().get("mesh_enabled", False))
    try:
        update_settings({"mesh_enabled": False})
        with TestClient(app) as c:
            assert c.get("/api/mesh/conflicts").status_code == 404

        update_settings({"mesh_enabled": True})
        with TestClient(app) as c:
            r = c.get("/api/mesh/conflicts")
            assert r.status_code == 200
            assert "conflicts" in r.json()
    finally:
        update_settings({"mesh_enabled": before})
