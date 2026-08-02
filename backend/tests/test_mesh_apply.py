"""Applying a peer's rows (ADR-024 §5, §6, §7, §13).

The three rules this module exists to enforce: nothing lands unjournaled,
conflicts are parked rather than decided, and the rest of the sync proceeds
regardless.
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
        for t in ("mesh_journal", "mesh_conflicts", "mesh_base",
                  "memo_collections", "memos", "collections"):
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


async def _get(mid="m1"):
    return await rowstore.read_row("memos", mid)


# -- the happy path ----------------------------------------------------------

async def test_a_new_row_from_a_peer_is_created():
    report = await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "new1", "hlc": NEW,
        "values": {"id": "new1", "type": "note", "title": "from the MacBook"},
    }], peer=PEER, take_snapshot=False)

    assert report.rows_applied == 1
    assert (await _get("new1"))["title"] == "from the MacBook"


async def test_an_edit_from_a_peer_is_applied():
    await _seed(title="before")
    await rowstore.set_base("memos", "m1", {"title": "before"}, OLD)

    await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "after"},
    }], peer=PEER, take_snapshot=False)

    assert (await _get())["title"] == "after"


# -- rule 1: nothing lands unjournaled ---------------------------------------

async def test_nothing_is_applied_without_a_journal_entry():
    """The contract from section 13. A write Mesh cannot explain is a bug."""
    await _seed(title="before")
    await rowstore.set_base("memos", "m1", {"title": "before"}, OLD)

    report = await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "after", "notes": "and a note"},
    }], peer=PEER, take_snapshot=False)

    entries = await journal.for_row("memos", "m1")
    assert len(entries) == report.fields_written, (
        "every field written must have exactly one journal entry"
    )
    assert {e.field for e in entries} == {"title", "notes"}
    assert all(e.rule for e in entries), "every entry must name the rule that fired"
    assert all(e.peer == PEER for e in entries)


async def test_the_journal_records_what_the_value_was_before():
    await _seed(title="the original")
    await rowstore.set_base("memos", "m1", {"title": "the original"}, OLD)
    await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "replaced"},
    }], peer=PEER, take_snapshot=False)

    matches = [e for e in await journal.for_row("memos", "m1") if e.field == "title"]
    assert len(matches) == 1
    assert matches[0].old_value == "the original", "undo needs the previous value"
    assert matches[0].new_value == "replaced"


# -- rule 2: conflicts are parked, not decided -------------------------------

async def test_a_contested_field_is_parked_and_the_local_value_left_alone():
    await _seed(title="what I typed here")
    await rowstore.set_base("memos", "m1", {"title": "the shared original"}, OLD)

    report = await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "what they typed"},
    }], peer=PEER, take_snapshot=False)

    assert report.conflicts == 1
    assert (await _get())["title"] == "what I typed here", (
        "a contested field must not change until the user decides"
    )
    conflicts = await mesh_apply.open_conflicts()
    assert len(conflicts) == 1
    c = conflicts[0]
    assert c["field"] == "title"
    assert c["local_value"] == "what I typed here"
    assert c["remote_value"] == "what they typed"
    assert c["base_value"] == "the shared original"


async def test_a_conflict_does_not_stall_the_rest_of_the_row():
    """Section 7: a pending conflict must never hold up the sync."""
    await _seed(title="mine", notes="")
    await rowstore.set_base("memos", "m1", {"title": "shared", "notes": ""}, OLD)

    await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "theirs",
                   "notes": "an uncontested note"},
    }], peer=PEER, take_snapshot=False)

    row = await _get()
    assert row["title"] == "mine", "contested, so untouched"
    assert row["notes"] == "an uncontested note", "uncontested, so applied"


async def test_a_contested_field_stays_contested_until_resolved():
    """The base must not advance over a disagreement, or the next sync would
    quietly adopt the peer's value as agreed."""
    await _seed(title="mine")
    await rowstore.set_base("memos", "m1", {"title": "shared"}, OLD)
    row = {"tbl": "memos", "row_id": "m1", "hlc": NEW,
           "values": {"id": "m1", "type": "note", "title": "theirs"}}

    await mesh_apply.apply_rows([row], peer=PEER, take_snapshot=False)
    second = await mesh_apply.apply_rows([row], peer=PEER, take_snapshot=False)

    assert second.conflicts == 1, "the disagreement must survive a second sync"
    assert (await _get())["title"] == "mine"


# -- refusing what it should refuse ------------------------------------------

@pytest.mark.parametrize("tbl", ["sqlite_master", "mesh_journal", "job_queue", "users"])
async def test_a_peer_cannot_name_a_table_that_is_not_synced(tbl):
    report = await mesh_apply.apply_rows([{
        "tbl": tbl, "row_id": "x", "hlc": NEW, "values": {"id": "x"},
    }], peer=PEER, take_snapshot=False)
    assert report.rows_applied == 0
    assert report.skipped, "it must say why, not fail silently"


async def test_unknown_columns_are_dropped_not_fatal():
    """A peer on a newer version legitimately knows fields this one does not.
    Refusing the whole row would strand the user on the older machine."""
    report = await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "n1", "hlc": NEW,
        "values": {"id": "n1", "type": "note", "title": "ok",
                   "a_field_from_the_future": "???"},
    }], peer=PEER, take_snapshot=False)

    assert report.rows_applied == 1
    assert (await _get("n1"))["title"] == "ok"


async def test_per_device_fields_never_arrive_from_a_peer():
    await _seed(file_path="D:/mine/song.flac")
    await mesh_apply.apply_rows([{
        "tbl": "memos", "row_id": "m1", "hlc": NEW,
        "values": {"id": "m1", "type": "note", "title": "t",
                   "file_path": "/their/path/song.opus"},
    }], peer=PEER, take_snapshot=False)

    assert (await _get())["file_path"] == "D:/mine/song.flac"


# -- membership --------------------------------------------------------------

async def test_membership_added_by_a_peer_is_applied():
    await _seed()
    async with AsyncSessionLocal() as db:
        await db.execute(text("INSERT INTO collections (id, name) VALUES ('c1', 'shelf')"))
        await db.commit()

    await mesh_apply.apply_rows([{
        "tbl": "memo_collections", "row_id": "m1|c1", "hlc": NEW, "present": True,
    }], peer=PEER, take_snapshot=False)

    assert await rowstore.link_present("memo_collections", "m1|c1")


async def test_a_newer_removal_from_a_peer_wins():
    await _seed()
    async with AsyncSessionLocal() as db:
        await db.execute(text("INSERT INTO collections (id, name) VALUES ('c1', 'shelf')"))
        await db.execute(text("INSERT INTO memo_collections (memo_id, collection_id) "
                              "VALUES ('m1', 'c1')"))
        await db.commit()
    await rowstore.set_base("memo_collections", "m1|c1", {"present": True, "__hlc": OLD}, OLD)

    await mesh_apply.apply_rows([{
        "tbl": "memo_collections", "row_id": "m1|c1", "hlc": NEW, "present": False,
    }], peer=PEER, take_snapshot=False)

    assert not await rowstore.link_present("memo_collections", "m1|c1")


# -- export ------------------------------------------------------------------

async def test_a_row_edited_many_times_ships_once():
    """What travels is the current state, not the history of getting there."""
    await _seed(title="final")
    entries = [
        {"tbl": "memos", "row_id": "m1", "op": "update", "hlc": OLD},
        {"tbl": "memos", "row_id": "m1", "op": "update", "hlc": NEW},
    ]
    out = await mesh_apply.export_rows(entries)
    assert len(out) == 1
    assert out[0]["values"]["title"] == "final"


async def test_export_strips_per_device_fields():
    await _seed(file_path="D:/private/path.flac")
    rows = await mesh_apply.export_rows(
        [{"tbl": "memos", "row_id": "m1", "op": "update", "hlc": NEW}]
    )
    assert len(rows) == 1
    assert "file_path" not in rows[0]["values"]
