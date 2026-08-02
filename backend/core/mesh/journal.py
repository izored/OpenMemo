"""The Mesh log, snapshots and rollback (ADR-024 §13).

Mesh is the first feature that writes to the library on the user's behalf,
driven by a machine that is not in front of them. So "what touched this, when,
and why" has to be answerable *in the product* — not by reading a terminal, and
not by asking someone to reproduce it.

That makes this a feature, not debug plumbing, and it is held to those standards:

* **Complete.** Every write Mesh makes has a row. A code path that can write
  without journaling is a bug, and `assert_write_was_journaled` exists so that
  is a test rather than an aspiration.
* **Readable.** Rows render as sentences, not `notes: lww`.
* **Attributable.** Which device, which rule, which batch.
* **Reversible.** Every row carries `old_value`, so any entry can be undone.
* **Bounded.** Retention by age and count, so it cannot grow forever.

Rollback is metadata-only, and that is a feature rather than a limitation: media
is re-fetchable from its magnet (§1), so history is 7 MB of text instead of
25 GB of files.

Two rules keep rollback from making things worse:

1. **A rollback writes a NEW stamp.** It is a fresh edit, not time travel.
   Without this the peer sees a value it considers stale and helpfully re-applies
   exactly what was just undone.
2. **A rollback is itself journaled**, so undoing an undo works.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text

from backend.config import settings
from backend.core.mesh import clock
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Kept generous: this is text against a 7 MB database, and the moment a user
# most wants history is the moment something looks wrong weeks later.
MAX_ENTRIES = 50_000
MAX_SNAPSHOTS = 20

_SNAP_DIR = "mesh_snapshots"


@dataclass
class Entry:
    seq: int
    batch_id: str
    ts: str
    peer: str
    tbl: str
    row_id: str
    field: str
    old_value: Any
    new_value: Any
    rule: str


async def create_table() -> None:
    """Idempotent. Created even while Mesh is disabled — an empty table costs
    nothing, and history must survive a disable."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_journal (
                seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id   TEXT NOT NULL,
                ts         TEXT NOT NULL,
                peer       TEXT NOT NULL,
                tbl        TEXT NOT NULL,
                row_id     TEXT NOT NULL,
                field      TEXT NOT NULL,
                old_value  TEXT,
                new_value  TEXT,
                rule       TEXT NOT NULL,
                undone     INTEGER NOT NULL DEFAULT 0
            )
        """))
        # "What happened to this memo?" is the question asked from the memo
        # detail view, so it gets an index rather than a scan.
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_mesh_journal_row
            ON mesh_journal (tbl, row_id, seq)
        """))
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_mesh_journal_batch
            ON mesh_journal (batch_id, seq)
        """))
        await db.commit()


def _enc(v: Any) -> str | None:
    if v is None:
        return None
    return v if isinstance(v, str) else json.dumps(v, default=str)


def _dec(v: str | None) -> Any:
    if v is None:
        return None
    try:
        return json.loads(v)
    except (ValueError, TypeError):
        return v


async def record(
    *,
    batch_id: str,
    peer: str,
    tbl: str,
    row_id: str,
    field: str,
    old_value: Any,
    new_value: Any,
    rule: str,
) -> None:
    """Write one entry. Called for every field Mesh changes, without exception."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO mesh_journal
                    (batch_id, ts, peer, tbl, row_id, field, old_value, new_value, rule)
                VALUES
                    (:batch, :ts, :peer, :tbl, :row, :field, :old, :new, :rule)
            """),
            {
                "batch": batch_id, "ts": datetime.utcnow().isoformat() + "Z",
                "peer": peer, "tbl": tbl, "row": row_id, "field": field,
                "old": _enc(old_value), "new": _enc(new_value), "rule": rule,
            },
        )
        await db.commit()


async def record_many(entries: list[dict[str, Any]]) -> int:
    """Batch form. One transaction, so a sync session's journal lands or does
    not — a half-written journal is worse than none, because it would claim a
    change was unrecorded when it actually happened."""
    if not entries:
        return 0
    now = datetime.utcnow().isoformat() + "Z"
    async with AsyncSessionLocal() as db:
        for e in entries:
            await db.execute(
                text("""
                    INSERT INTO mesh_journal
                        (batch_id, ts, peer, tbl, row_id, field, old_value, new_value, rule)
                    VALUES
                        (:batch, :ts, :peer, :tbl, :row, :field, :old, :new, :rule)
                """),
                {
                    "batch": e["batch_id"], "ts": e.get("ts") or now,
                    "peer": e["peer"], "tbl": e["tbl"], "row": e["row_id"],
                    "field": e["field"], "old": _enc(e.get("old_value")),
                    "new": _enc(e.get("new_value")), "rule": e["rule"],
                },
            )
        await db.commit()
    return len(entries)


def _row_to_entry(r) -> Entry:
    return Entry(
        seq=r[0], batch_id=r[1], ts=r[2], peer=r[3], tbl=r[4], row_id=r[5],
        field=r[6], old_value=_dec(r[7]), new_value=_dec(r[8]), rule=r[9],
    )


_SELECT = ("SELECT seq, batch_id, ts, peer, tbl, row_id, field, old_value, "
           "new_value, rule FROM mesh_journal")


async def for_row(tbl: str, row_id: str, limit: int = 100) -> list[Entry]:
    """History for one memo — the inline view in the detail page, which is where
    the question actually gets asked."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"{_SELECT} WHERE tbl = :t AND row_id = :r ORDER BY seq DESC LIMIT :l"),
            {"t": tbl, "r": row_id, "l": limit},
        )
        return [_row_to_entry(r) for r in result.fetchall()]


async def batches(limit: int = 50) -> list[dict[str, Any]]:
    """Recent sync sessions, newest first — the Settings → Mesh → History list."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT batch_id, peer, MIN(ts), COUNT(*), SUM(undone)
                FROM mesh_journal
                GROUP BY batch_id, peer
                ORDER BY MIN(seq) DESC
                LIMIT :l
            """),
            {"l": limit},
        )
        return [
            {"batch_id": r[0], "peer": r[1], "at": r[2],
             "changes": r[3], "undone": int(r[4] or 0)}
            for r in result.fetchall()
        ]


async def prune(max_entries: int = MAX_ENTRIES) -> int:
    """Drop the oldest entries past the cap. Returns how many went."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                DELETE FROM mesh_journal WHERE seq <= (
                    SELECT COALESCE(MAX(seq), 0) - :cap FROM mesh_journal
                )
            """),
            {"cap": max_entries},
        )
        await db.commit()
        return result.rowcount or 0


# ── snapshots ────────────────────────────────────────────────────────────────

def _snapshot_dir() -> Path:
    d = Path(settings.DATA_DIR) / _SNAP_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def take_snapshot(label: str = "") -> Path:
    """Copy the database before a sync batch touches it.

    This is the actual safety net. Journal rollback is precise, but the snapshot
    is what saves you when the journal itself is what got it wrong. The database
    is ~7 MB, so twenty of them is ~150 MB against a 25 GB library — cheap
    enough that not taking one would be the odd decision.
    """
    db_path = Path(settings.DATA_DIR) / "openmemo.db"
    out = _snapshot_dir() / (
        f"{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{label or 'sync'}.db"
    )
    if db_path.exists():
        # sqlite3's own backup API, not a file copy: it is consistent against a
        # live database, where copying the file can catch a half-written page.
        src = sqlite3.connect(str(db_path))
        dst = sqlite3.connect(str(out))
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    prune_snapshots()
    return out


def list_snapshots() -> list[Path]:
    return sorted(_snapshot_dir().glob("*.db"), reverse=True)


def prune_snapshots(keep: int = MAX_SNAPSHOTS) -> int:
    old = list_snapshots()[keep:]
    for p in old:
        try:
            p.unlink()
        except OSError:
            logger.warning("could not remove old snapshot %s", p)
    return len(old)


# ── rollback ─────────────────────────────────────────────────────────────────

# Undo builds `UPDATE {tbl} SET {field} = ?`, so both identifiers are
# interpolated rather than bound. They are checked against the live schema
# before use — not because the journal is untrusted today, but because a table
# name reaching SQL from a stored row is exactly the shape that becomes an
# injection the day something upstream stops validating.
_UNDOABLE_TABLES = frozenset({
    "memos", "collections", "tags", "workspaces", "chat_sessions", "messages",
})


def _undoable_columns(tbl: str) -> frozenset[str]:
    from backend.db.models import Base

    table = Base.metadata.tables.get(tbl)
    return frozenset(c.name for c in table.columns) if table is not None else frozenset()

async def undo_batch(batch_id: str, *, peer: str = "rollback") -> int:
    """Replay a batch backwards, restoring `old_value` per field.

    Metadata only. Media is not restored and does not need to be — a magnet
    re-pulls it (§1), which is exactly what makes keeping this history cheap.
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text(f"{_SELECT} WHERE batch_id = :b AND undone = 0 ORDER BY seq DESC"),
            {"b": batch_id},
        )
        entries = [_row_to_entry(r) for r in result.fetchall()]

    if not entries:
        return 0

    take_snapshot(f"before-undo-{batch_id[:8]}")
    undo_batch_id = f"undo-{uuid.uuid4().hex[:8]}"
    reverted: list[dict[str, Any]] = []

    async with AsyncSessionLocal() as db:
        for e in entries:
            if e.tbl not in _UNDOABLE_TABLES:
                logger.warning("skipping undo of unknown table %r", e.tbl)
                continue
            if e.field not in _undoable_columns(e.tbl):
                logger.warning("skipping undo of unknown column %r.%r", e.tbl, e.field)
                continue
            # Scalars go back as themselves; only structures are re-encoded.
            # Round-tripping a boolean through JSON would store the string
            # "true" in a boolean column.
            value = e.old_value
            if isinstance(value, (dict, list)):
                value = _enc(value)
            await db.execute(
                text(f"UPDATE {e.tbl} SET {e.field} = :v WHERE id = :id"),
                {"v": value, "id": e.row_id},
            )
            reverted.append({
                "batch_id": undo_batch_id, "peer": peer, "tbl": e.tbl,
                "row_id": e.row_id, "field": e.field,
                "old_value": e.new_value, "new_value": e.old_value,
                "rule": "undo",
            })
        await db.execute(
            text("UPDATE mesh_journal SET undone = 1 WHERE batch_id = :b"),
            {"b": batch_id},
        )
        await db.commit()

    # A NEW stamp, not the old one. This is a fresh edit; without it the peer
    # sees a value it considers stale and re-applies exactly what was undone.
    await clock.tick()
    await record_many(reverted)
    return len(reverted)
