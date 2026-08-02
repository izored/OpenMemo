"""Change log and its triggers (ADR-024 §4).

Only `Memo` has `updated_at`, and only `Memo` has a soft delete. `Collection`,
`Tag`, `Workspace`, `ChatSession` have neither. So a scan-based sync cannot see
that a collection was deleted — the row is simply gone — and the peer, which
still has it, helpfully sends it back. Zombie collections.

Triggers fix that without touching a single API route:

* Deletes become real tombstones for tables that hard-delete today.
* Every write is caught, whatever made it — a route, a migration script, someone
  poking the database with sqlite3. There is no code path to forget.
* The sync cursor is one integer per peer instead of a scan.

The HLC is advanced inside the trigger, in the same transaction as the write it
records. That is the whole reason the clock lives in SQL (see `clock.py`): the
log's order and the database's order cannot drift apart if they are committed
together.

Created on enable, dropped on disable (§0). A user who never turns Mesh on pays
nothing per write — not a trigger, not a `WHEN` clause, nothing.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from backend.core.mesh.clock import SQL_NOW_MILLIS, create_table as create_clock
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Tables whose rows are part of the library and therefore sync.
#
# Not here on purpose: job_queue (this device's to-do list, §9), mesh_* (the
# machinery itself), users (one local user, never meaningful to merge).
SYNCED_TABLES: dict[str, str] = {
    "memos": "id",
    "collections": "id",
    "tags": "id",
    "workspaces": "id",
    "chat_sessions": "id",
    "messages": "id",
}

# Association tables have a composite key, so `row_id` is both halves joined.
# The pair IS the identity: "memo M is in collection C" is the thing that gets
# added or removed, and a tombstone has to name both ends to be actionable.
LINK_TABLES: dict[str, tuple[str, str]] = {
    "memo_collections": ("memo_id", "collection_id"),
    "memo_tags": ("memo_id", "tag_id"),
}

_LOG_TABLE = "mesh_change_log"


def _stamp_sql() -> str:
    """SQL that advances the clock and yields the new stamp.

    Inlined into every trigger rather than factored into a view, because SQLite
    triggers cannot call user functions and a view cannot have side effects. The
    duplication is generated, never hand-maintained.
    """
    return f"""
        UPDATE mesh_clock SET
            counter = CASE WHEN {SQL_NOW_MILLIS} > millis THEN 0 ELSE counter + 1 END,
            millis  = MAX({SQL_NOW_MILLIS}, millis)
        WHERE id = 1;
    """


def _insert_sql(table: str, row_expr: str, op: str) -> str:
    return f"""
        INSERT INTO {_LOG_TABLE} (tbl, row_id, op, hlc, device_id)
        SELECT '{table}', {row_expr}, '{op}',
               printf('%016d-%06d-%s', millis, counter, device_id), device_id
        FROM mesh_clock WHERE id = 1;
    """


def _triggers_for(table: str, row_expr_new: str, row_expr_old: str) -> list[tuple[str, str]]:
    """(name, SQL) for the three triggers on one table."""
    out = []
    for op, when, row_expr in (
        ("insert", "AFTER INSERT", row_expr_new),
        ("update", "AFTER UPDATE", row_expr_new),
        ("delete", "AFTER DELETE", row_expr_old),
    ):
        name = f"mesh_{table}_{op}"
        sql = (
            f"CREATE TRIGGER IF NOT EXISTS {name} {when} ON {table} "
            f"BEGIN {_stamp_sql()} {_insert_sql(table, row_expr, op)} END;"
        )
        out.append((name, sql))
    return out


def all_trigger_names() -> list[str]:
    names = []
    for table in list(SYNCED_TABLES) + list(LINK_TABLES):
        names += [f"mesh_{table}_{op}" for op in ("insert", "update", "delete")]
    return names


async def create_log_table() -> None:
    """Create the log itself. Idempotent, and safe while Mesh is disabled —
    an empty table costs nothing; it is the triggers that cost per-write."""
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"""
            CREATE TABLE IF NOT EXISTS {_LOG_TABLE} (
                seq       INTEGER PRIMARY KEY AUTOINCREMENT,
                tbl       TEXT NOT NULL,
                row_id    TEXT NOT NULL,
                op        TEXT NOT NULL,
                hlc       TEXT NOT NULL,
                device_id TEXT NOT NULL
            )
        """))
        # A peer's cursor is "everything after seq N", so the primary key already
        # serves it. This index serves the other question — "what happened to
        # this row?" — which the journal and the conflict dialogue both ask.
        await db.execute(text(f"""
            CREATE INDEX IF NOT EXISTS ix_mesh_change_log_row
            ON {_LOG_TABLE} (tbl, row_id, seq)
        """))
        await db.commit()


async def enable_triggers() -> int:
    """Install every trigger. Returns how many now exist. Idempotent."""
    await create_clock()
    await create_log_table()

    statements: list[str] = []
    for table in SYNCED_TABLES:
        statements += [sql for _, sql in _triggers_for(table, "NEW.id", "OLD.id")]
    for table, (a, b) in LINK_TABLES.items():
        statements += [
            sql
            for _, sql in _triggers_for(
                table, f"NEW.{a} || '|' || NEW.{b}", f"OLD.{a} || '|' || OLD.{b}"
            )
        ]

    async with AsyncSessionLocal() as db:
        for sql in statements:
            await db.execute(text(sql))
        await db.commit()
    count = await installed_trigger_count()
    logger.info("mesh: %d change-log trigger(s) active", count)
    return count


async def disable_triggers() -> int:
    """Drop every trigger. Returns how many were removed.

    The log and its history are deliberately left intact: turning Mesh off and
    on again should not look like a factory reset.
    """
    async with AsyncSessionLocal() as db:
        for name in all_trigger_names():
            await db.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
        await db.commit()
    remaining = await installed_trigger_count()
    logger.info("mesh: change-log triggers dropped (%d remaining)", remaining)
    return remaining


async def installed_trigger_count() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type = 'trigger' AND name LIKE 'mesh\\_%' ESCAPE '\\'"
        ))
        return int(result.scalar() or 0)


async def changes_since(seq: int = 0, limit: int = 1000) -> list[dict[str, Any]]:
    """Rows the peer has not seen, oldest first.

    Returns log entries, not row contents. What changed and when is the sync
    cursor's business; fetching the current state of those rows is the
    protocol's (§5), and keeping them separate means a row edited ten times
    ships once.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"""
                SELECT seq, tbl, row_id, op, hlc, device_id
                FROM {_LOG_TABLE}
                WHERE seq > :seq
                ORDER BY seq ASC
                LIMIT :limit
            """),
            {"seq": seq, "limit": limit},
        )
        return [
            {"seq": r[0], "tbl": r[1], "row_id": r[2], "op": r[3],
             "hlc": r[4], "device_id": r[5]}
            for r in result.fetchall()
        ]


async def latest_seq() -> int:
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(f"SELECT COALESCE(MAX(seq), 0) FROM {_LOG_TABLE}"))
        return int(result.scalar() or 0)
