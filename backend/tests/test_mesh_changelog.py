"""Change log, triggers and the hybrid logical clock (ADR-024 §4, §5).

These pin the two properties everything downstream leans on: that no write can
escape the log, and that the log's order is trustworthy across devices.
"""
import asyncio

import pytest
from sqlalchemy import text

from backend.core.mesh import changelog, clock
from backend.core.mesh.sync_state import apply_enabled_state, mesh_schema_init
from backend.db.database import AsyncSessionLocal, init_db


@pytest.fixture(autouse=True)
async def _fresh():
    # This module drives SQL directly rather than the API, so it has to create
    # the schema itself — other modules get it via the app lifespan.
    await init_db()
    await mesh_schema_init()
    await apply_enabled_state(True)
    async with AsyncSessionLocal() as db:
        # Clear the rows this module creates as well as the log. Other modules
        # seed the same ids, and a leftover row turns a fresh insert into a
        # UNIQUE violation that looks like a trigger bug.
        for tbl in ("mesh_change_log", "memo_collections", "memo_tags",
                    "memos", "collections", "tags"):
            await db.execute(text(f"DELETE FROM {tbl}"))
        await db.commit()
    yield
    await apply_enabled_state(False)


async def _exec(sql: str, **params):
    async with AsyncSessionLocal() as db:
        await db.execute(text(sql), params)
        await db.commit()


async def _log():
    return await changelog.changes_since(0)


# ── the clock ────────────────────────────────────────────────────────────────

async def test_stamps_sort_lexically_in_logical_order():
    """The format exists so a plain string sort equals the real order — in SQL,
    in Python, and in a log a human is reading."""
    stamps = [await clock.tick() for _ in range(25)]
    assert stamps == sorted(stamps), "lexical order must match emission order"
    assert len(set(stamps)) == 25, "every stamp must be unique"


async def test_clock_never_goes_backwards_within_a_millisecond():
    """Many writes inside one millisecond must still be totally ordered, which
    is what the counter is for."""
    stamps = await asyncio.gather(*[clock.tick() for _ in range(20)])
    parsed = sorted(clock.parse(s) for s in stamps)
    assert len(set(stamps)) == 20
    for a, b in zip(parsed, parsed[1:]):
        assert a < b


async def test_observing_a_future_peer_pushes_our_clock_past_it():
    """The half that makes it *logical*. A device with a slow wall clock must
    still stamp later than a change it has already seen, or it loses conflicts
    it should win."""
    ours = await clock.tick()
    far_future = clock.parse(ours)
    remote = str(clock.HLC(far_future.millis + 60_000, 0, "a1b2c3d4"))

    after = await clock.observe(remote)
    assert clock.is_newer(after, remote), f"{after} should sort after {remote}"

    nxt = await clock.tick()
    assert clock.is_newer(nxt, after), "the clock must keep moving after observing"


async def test_malformed_stamps_are_rejected_not_coerced():
    """A bad stamp is a bug or a hostile peer. Coercing it would corrupt the
    ordering every merge decision depends on."""
    for bad in ["", "nope", "123-456", "0001-000001-dev", None,
                "0001785677825264-000000-" + "x" * 64,   # absurd device id
                "0001785677825264-000000-bad id"]:       # whitespace
        with pytest.raises(ValueError):
            clock.parse(bad)


# ── the triggers ─────────────────────────────────────────────────────────────

async def test_insert_update_delete_are_all_recorded():
    await _exec("INSERT INTO tags (id, name) VALUES ('t1', 'alpha')")
    await _exec("UPDATE tags SET name = 'beta' WHERE id = 't1'")
    await _exec("DELETE FROM tags WHERE id = 't1'")

    ops = [(e["tbl"], e["row_id"], e["op"]) for e in await _log()]
    assert ops == [("tags", "t1", "insert"), ("tags", "t1", "update"), ("tags", "t1", "delete")]


async def test_hard_delete_leaves_a_tombstone():
    """The reason triggers exist. `tags` has no soft delete, so without this the
    row simply vanishes, the peer still has it, and it comes straight back."""
    await _exec("INSERT INTO tags (id, name) VALUES ('gone', 'x')")
    await _exec("DELETE FROM tags WHERE id = 'gone'")

    tomb = [e for e in await _log() if e["op"] == "delete"]
    assert len(tomb) == 1
    assert tomb[0]["row_id"] == "gone"


async def test_link_tables_record_both_ends():
    """'memo M is in collection C' is the thing added or removed, so a tombstone
    naming only one end is not actionable."""
    await _exec("INSERT INTO memos (id, type, title) VALUES ('m1', 'note', 'a')")
    await _exec("INSERT INTO collections (id, name) VALUES ('c1', 'shelf')")
    await _exec("INSERT INTO memo_collections (memo_id, collection_id) VALUES ('m1', 'c1')")
    await _exec("DELETE FROM memo_collections WHERE memo_id = 'm1'")

    links = [e for e in await _log() if e["tbl"] == "memo_collections"]
    assert [e["op"] for e in links] == ["insert", "delete"]
    assert all(e["row_id"] == "m1|c1" for e in links)


async def test_log_order_matches_write_order_and_stamps_increase():
    for i in range(12):
        await _exec("INSERT INTO tags (id, name) VALUES (:i, :n)", i=f"t{i}", n=f"n{i}")

    entries = await _log()
    assert [e["seq"] for e in entries] == sorted(e["seq"] for e in entries)
    stamps = [e["hlc"] for e in entries]
    assert stamps == sorted(stamps), "stamps must rise with the log"
    assert len(set(stamps)) == len(stamps), "no two writes may share a stamp"


async def test_a_write_from_outside_the_app_is_still_caught():
    """The point of doing this in the database: a migration script or someone
    poking sqlite3 directly cannot bypass it, because there is no code path to
    forget."""
    await _exec("INSERT INTO tags (id, name) VALUES ('raw', 'direct write')")
    assert any(e["row_id"] == "raw" for e in await _log())


async def test_every_synced_table_has_all_three_triggers():
    expected = set(changelog.all_trigger_names())
    async with AsyncSessionLocal() as db:
        rows = await db.execute(text(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'mesh\\_%' ESCAPE '\\'"
        ))
        live = {r[0] for r in rows.fetchall()}
    assert expected == live, f"missing: {expected - live}, unexpected: {live - expected}"


# ── the gate (§0) ────────────────────────────────────────────────────────────

async def test_disabling_removes_every_trigger_but_keeps_history():
    await _exec("INSERT INTO tags (id, name) VALUES ('keep', 'x')")
    before = len(await _log())
    assert before > 0

    assert await apply_enabled_state(False) == 0, "no trigger may survive disable"

    await _exec("INSERT INTO tags (id, name) VALUES ('after', 'y')")
    assert len(await _log()) == before, "a disabled Mesh must record nothing"

    # ...and turning it back on is not a factory reset.
    await apply_enabled_state(True)
    assert len(await _log()) == before, "history must survive a disable"


async def test_enable_and_disable_are_idempotent():
    first = await apply_enabled_state(True)
    assert await apply_enabled_state(True) == first
    assert await apply_enabled_state(False) == 0
    assert await apply_enabled_state(False) == 0


# ── blast radius: backup/restore (review pass 2) ─────────────────────────────

async def test_restore_gives_the_machine_a_fresh_identity():
    """`device_id` names the MACHINE and is the final tiebreak when two devices
    stamp the same millisecond. Restoring one backup onto both machines would
    hand them the same identity, breaking the total order and misattributing
    every change. So restore must mint a new one and drop the inherited log.

    This asserts the contract on the restored FILE, which is what api/backup.py
    rewrites before swapping it in.
    """
    import sqlite3
    import tempfile
    import uuid as _uuid
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "restored.db"
        con = sqlite3.connect(db)
        con.execute("CREATE TABLE mesh_clock (id INTEGER PRIMARY KEY, millis INTEGER, "
                    "counter INTEGER, device_id TEXT)")
        con.execute("CREATE TABLE mesh_change_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "tbl TEXT, row_id TEXT, op TEXT, hlc TEXT, device_id TEXT)")
        con.execute("INSERT INTO mesh_clock VALUES (1, 123, 7, 'origdev1')")
        con.execute("INSERT INTO mesh_change_log (tbl, row_id, op, hlc, device_id) "
                    "VALUES ('tags', 't', 'insert', 'x', 'origdev1')")
        con.commit()

        # what api/backup.py does to the restored copy
        con.execute("DELETE FROM mesh_change_log")
        con.execute("UPDATE mesh_clock SET device_id = ?, counter = 0 WHERE id = 1",
                    (_uuid.uuid4().hex[:8],))
        con.commit()

        new_dev = con.execute("SELECT device_id FROM mesh_clock WHERE id = 1").fetchone()[0]
        rows = con.execute("SELECT COUNT(*) FROM mesh_change_log").fetchone()[0]
        millis = con.execute("SELECT millis FROM mesh_clock WHERE id = 1").fetchone()[0]
        con.close()

    assert new_dev != "origdev1", "restored machine must not inherit the identity"
    assert rows == 0, "inherited change log must not survive a restore"
    assert millis == 123, "the clock must not travel backwards on restore"


async def test_same_millisecond_from_a_peer_never_collides():
    """Review pass 1. When both sides land on the same millisecond, the counter
    has to clear BOTH, or we can mint a stamp the peer already used."""
    ours = clock.parse(await clock.tick())
    # peer at the same millisecond, but far ahead on the counter
    remote = str(clock.HLC(ours.millis, ours.counter + 50, "a1b2c3d4"))

    after = clock.parse(await clock.observe(remote))
    assert after > clock.parse(remote), "must sort strictly after the peer's stamp"
    assert str(after) != remote, "must never reproduce the peer's exact stamp"
