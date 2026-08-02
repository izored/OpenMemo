"""The Mesh log, snapshots and rollback (ADR-024 §13).

The contract: nothing Mesh writes is unexplained, and nothing it writes is
permanent. These pin both, plus the two rules that stop rollback from making
things worse.
"""
import pytest
from sqlalchemy import text

from backend.core.mesh import clock, journal
from backend.core.mesh.sync_state import mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db


@pytest.fixture(autouse=True)
async def _fresh():
    await init_db()
    await mesh_schema_init()
    await journal.create_table()
    async with AsyncSessionLocal() as db:
        await db.execute(text("DELETE FROM mesh_journal"))
        await db.execute(text("DELETE FROM memos"))
        await db.commit()
    yield


async def _memo(mid="m1", **cols):
    fields = {"id": mid, "type": "note", "title": "original", **cols}
    keys = ", ".join(fields)
    binds = ", ".join(f":{k}" for k in fields)
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"INSERT INTO memos ({keys}) VALUES ({binds})"), fields)
        await db.commit()


async def _title(mid="m1"):
    async with AsyncSessionLocal() as db:
        r = await db.execute(text("SELECT title FROM memos WHERE id = :i"), {"i": mid})
        row = r.first()
        return row[0] if row else None


# ── recording ────────────────────────────────────────────────────────────────

async def test_an_entry_captures_why_not_just_what():
    """The question after a bad sync is never "what changed" but "why did it
    change" — so the rule that fired is a first-class column."""
    await journal.record(
        batch_id="b1", peer="MacBook", tbl="memos", row_id="m1",
        field="title", old_value="before", new_value="after", rule="lww",
    )
    [e] = await journal.for_row("memos", "m1")
    assert (e.peer, e.field, e.old_value, e.new_value, e.rule) == (
        "MacBook", "title", "before", "after", "lww",
    )


async def test_structured_values_survive_the_round_trip():
    """`summaries` is a dict; a journal that flattened it to a string could not
    restore it."""
    payload = {"essay": "long text", "insights": ["a", "b"]}
    await journal.record(
        batch_id="b1", peer="p", tbl="memos", row_id="m1",
        field="summaries", old_value=None, new_value=payload, rule="union",
    )
    [e] = await journal.for_row("memos", "m1")
    assert e.new_value == payload
    assert e.old_value is None


async def test_batches_group_a_sync_session():
    await journal.record_many([
        {"batch_id": "b1", "peer": "Mac", "tbl": "memos", "row_id": f"m{i}",
         "field": "title", "old_value": "x", "new_value": "y", "rule": "lww"}
        for i in range(5)
    ])
    [b] = await journal.batches()
    assert b["batch_id"] == "b1" and b["changes"] == 5 and b["peer"] == "Mac"


async def test_history_is_bounded():
    """Text against a 7 MB database, but not unbounded."""
    await journal.record_many([
        {"batch_id": "b", "peer": "p", "tbl": "memos", "row_id": "m",
         "field": "title", "old_value": None, "new_value": str(i), "rule": "lww"}
        for i in range(60)
    ])
    removed = await journal.prune(max_entries=20)
    assert removed == 40
    assert len(await journal.for_row("memos", "m", limit=999)) == 20


# ── rollback ─────────────────────────────────────────────────────────────────

async def test_undo_restores_the_previous_value():
    await _memo(title="synced value")
    await journal.record(
        batch_id="bad", peer="MacBook", tbl="memos", row_id="m1",
        field="title", old_value="what I wrote", new_value="synced value", rule="lww",
    )

    assert await journal.undo_batch("bad") == 1
    assert await _title() == "what I wrote"


async def test_undo_is_itself_journaled_so_it_can_be_undone():
    await _memo(title="synced value")
    await journal.record(
        batch_id="bad", peer="Mac", tbl="memos", row_id="m1",
        field="title", old_value="mine", new_value="synced value", rule="lww",
    )
    await journal.undo_batch("bad")

    undo = [b for b in await journal.batches() if b["batch_id"].startswith("undo-")]
    assert len(undo) == 1, "the undo must appear in history like any other change"

    await journal.undo_batch(undo[0]["batch_id"])
    assert await _title() == "synced value", "undoing an undo must work"


async def test_undo_advances_the_clock_rather_than_rewinding_it():
    """Rollback is a fresh edit, not time travel. Without a new stamp the peer
    sees a value it considers stale and re-applies exactly what was undone."""
    await _memo(title="synced")
    before = await clock.tick()
    await journal.record(
        batch_id="bad", peer="Mac", tbl="memos", row_id="m1",
        field="title", old_value="mine", new_value="synced", rule="lww",
    )
    await journal.undo_batch("bad")
    after = await clock.tick()
    assert clock.is_newer(after, before), "the clock must have moved forward"


async def test_a_batch_cannot_be_undone_twice():
    await _memo(title="synced")
    await journal.record(
        batch_id="bad", peer="Mac", tbl="memos", row_id="m1",
        field="title", old_value="mine", new_value="synced", rule="lww",
    )
    assert await journal.undo_batch("bad") == 1
    assert await journal.undo_batch("bad") == 0, "already undone"
    assert await _title() == "mine"


async def test_undo_refuses_unknown_tables_and_columns():
    """Review pass 2. Undo interpolates the table and column into SQL, so both
    are checked against the live schema — the shape that becomes an injection
    the day something upstream stops validating."""
    await _memo(title="untouched")
    await journal.record_many([
        {"batch_id": "evil", "peer": "p", "tbl": "sqlite_master", "row_id": "m1",
         "field": "name", "old_value": "x", "new_value": "y", "rule": "lww"},
        {"batch_id": "evil", "peer": "p", "tbl": "memos", "row_id": "m1",
         "field": "title = 'pwned' --", "old_value": "x", "new_value": "y", "rule": "lww"},
    ])
    assert await journal.undo_batch("evil") == 0, "both entries must be refused"
    assert await _title() == "untouched"


# ── snapshots ────────────────────────────────────────────────────────────────

async def test_a_snapshot_is_taken_and_capped():
    """The real safety net: journal rollback is precise, but the snapshot is
    what saves you when the journal itself is what got it wrong."""
    made = [journal.take_snapshot(f"t{i}") for i in range(3)]
    assert all(p.exists() for p in made)
    assert len(journal.list_snapshots()) >= 3

    journal.prune_snapshots(keep=2)
    assert len(journal.list_snapshots()) == 2


async def test_undo_snapshots_before_it_touches_anything():
    await _memo(title="synced")
    await journal.record(
        batch_id="bad", peer="Mac", tbl="memos", row_id="m1",
        field="title", old_value="mine", new_value="synced", rule="lww",
    )
    before = len(journal.list_snapshots())
    await journal.undo_batch("bad")
    assert len(journal.list_snapshots()) > before
