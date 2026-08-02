"""Reading and writing synced rows, and remembering the agreed base (§5, §6).

Two jobs the merge engine deliberately does not do, because it is pure:

1. **Fetch and apply rows** generically, by table name and id.
2. **Remember the base** — the row as it stood when the two devices last agreed.
   Without it a three-way merge is impossible and every difference looks like a
   conflict (§6).

`mesh_base` is that memory. It is written *after* a successful merge, never
before: if a sync dies halfway, the base still describes the last state both
sides actually agreed on, so the next attempt re-merges rather than silently
treating a partial result as settled.

Every table and column that reaches SQL here is checked against the live schema
first. The values come from a peer, so the identifiers must never be able to.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text

from backend.core.mesh.changelog import LINK_TABLES, SYNCED_TABLES
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _columns(tbl: str) -> frozenset[str]:
    from backend.db.models import Base

    table = Base.metadata.tables.get(tbl)
    return frozenset(c.name for c in table.columns) if table is not None else frozenset()


def is_syncable(tbl: str) -> bool:
    return tbl in SYNCED_TABLES or tbl in LINK_TABLES


async def create_table() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_base (
                tbl     TEXT NOT NULL,
                row_id  TEXT NOT NULL,
                payload TEXT NOT NULL,
                hlc     TEXT,
                PRIMARY KEY (tbl, row_id)
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_peers (
                device_id     TEXT PRIMARY KEY,
                name          TEXT,
                last_seen_seq INTEGER NOT NULL DEFAULT 0,
                last_sync     TEXT
            )
        """))
        await db.commit()


async def read_row(tbl: str, row_id: str) -> dict[str, Any] | None:
    """Current state of one row, or None if it is gone."""
    if tbl not in SYNCED_TABLES:
        return None
    cols = _columns(tbl)
    if not cols:
        return None
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"SELECT {', '.join(sorted(cols))} FROM {tbl} WHERE id = :i"),
            {"i": row_id},
        )
        row = result.first()
    if row is None:
        return None
    return dict(zip(sorted(cols), row))


async def apply_values(tbl: str, row_id: str, values: dict[str, Any]) -> int:
    """Write merged values onto a row, inserting it if it is new.

    Returns how many columns were written. Unknown columns are dropped with a
    warning rather than failing the whole sync: a peer on a newer version will
    legitimately know fields this one does not, and refusing the entire row over
    it would strand the user on the older machine.
    """
    if tbl not in SYNCED_TABLES:
        logger.warning("mesh: refusing to write unknown table %r", tbl)
        return 0

    cols = _columns(tbl)
    clean = {k: v for k, v in values.items() if k in cols and k != "id"}
    unknown = set(values) - cols
    if unknown:
        logger.info("mesh: ignoring unknown column(s) %s on %s", sorted(unknown), tbl)
    if not clean:
        return 0

    # JSON columns arrive decoded; SQLite wants text.
    payload = {
        k: (json.dumps(v) if isinstance(v, (dict, list)) else v)
        for k, v in clean.items()
    }

    async with AsyncSessionLocal() as db:
        exists = (await db.execute(
            text(f"SELECT 1 FROM {tbl} WHERE id = :i"), {"i": row_id}
        )).first()

        if exists:
            assignments = ", ".join(f"{c} = :{c}" for c in payload)
            await db.execute(
                text(f"UPDATE {tbl} SET {assignments} WHERE id = :__id"),
                {**payload, "__id": row_id},
            )
        else:
            payload["id"] = row_id
            names = ", ".join(payload)
            binds = ", ".join(f":{c}" for c in payload)
            await db.execute(text(f"INSERT INTO {tbl} ({names}) VALUES ({binds})"), payload)
        await db.commit()
    return len(clean)


async def get_base(tbl: str, row_id: str) -> dict[str, Any] | None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("SELECT payload FROM mesh_base WHERE tbl = :t AND row_id = :r"),
            {"t": tbl, "r": row_id},
        )
        row = result.first()
    if row is None:
        return None
    try:
        return json.loads(row[0])
    except ValueError:
        return None


async def set_base(tbl: str, row_id: str, payload: dict[str, Any], hlc: str | None = None) -> None:
    """Record what both sides now agree on. Called only after a merge lands."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO mesh_base (tbl, row_id, payload, hlc)
                VALUES (:t, :r, :p, :h)
                ON CONFLICT (tbl, row_id) DO UPDATE SET payload = :p, hlc = :h
            """),
            {"t": tbl, "r": row_id, "p": json.dumps(payload, default=str), "h": hlc},
        )
        await db.commit()


async def link_present(tbl: str, row_id: str) -> bool:
    """Whether a membership row exists. `row_id` is 'left|right' (§4)."""
    if tbl not in LINK_TABLES:
        return False
    left_col, right_col = LINK_TABLES[tbl]
    try:
        left, right = row_id.split("|", 1)
    except ValueError:
        return False
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"SELECT 1 FROM {tbl} WHERE {left_col} = :l AND {right_col} = :r"),
            {"l": left, "r": right},
        )
        return result.first() is not None


async def set_link(tbl: str, row_id: str, present: bool) -> bool:
    """Add or remove a membership. Returns True if anything changed."""
    if tbl not in LINK_TABLES:
        return False
    left_col, right_col = LINK_TABLES[tbl]
    try:
        left, right = row_id.split("|", 1)
    except ValueError:
        return False

    current = await link_present(tbl, row_id)
    if current == present:
        return False

    async with AsyncSessionLocal() as db:
        if present:
            await db.execute(
                text(f"INSERT OR IGNORE INTO {tbl} ({left_col}, {right_col}) "
                     "VALUES (:l, :r)"),
                {"l": left, "r": right},
            )
        else:
            await db.execute(
                text(f"DELETE FROM {tbl} WHERE {left_col} = :l AND {right_col} = :r"),
                {"l": left, "r": right},
            )
        await db.commit()
    return True
