"""Applying a peer's rows (ADR-024 §5, §6, §7, §13).

Where the pure merge engine meets the database. Three rules govern everything
here, and they are the reason this is a separate module rather than a few lines
inside the session:

1. **Nothing lands unjournaled.** Every field written gets a journal row naming
   the rule that produced it. If a code path can write without journalling, it
   is a bug, and `test_nothing_is_applied_without_a_journal_entry` says so.
2. **Conflicts are parked, not decided.** A field both humans edited is stored
   as pending and the local value is left alone. The rest of the row still
   applies — a pending conflict must never stall the sync (§7).
3. **A snapshot precedes the batch.** Journal rollback is precise; the snapshot
   is what saves you when the journal itself is what got it wrong (§13).
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text

from backend.core.mesh import clock, journal, merge, rowstore
from backend.core.mesh.changelog import LINK_TABLES, SYNCED_TABLES
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


@dataclass
class ApplyReport:
    batch_id: str
    rows_applied: int = 0
    fields_written: int = 0
    conflicts: int = 0
    skipped: list[str] = field(default_factory=list)


async def create_table() -> None:
    """Pending conflicts, waiting for the dialogue (§7)."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_conflicts (
                id           TEXT PRIMARY KEY,
                batch_id     TEXT NOT NULL,
                peer         TEXT NOT NULL,
                tbl          TEXT NOT NULL,
                row_id       TEXT NOT NULL,
                field        TEXT NOT NULL,
                local_value  TEXT,
                remote_value TEXT,
                base_value   TEXT,
                created_at   TEXT NOT NULL,
                resolved     INTEGER NOT NULL DEFAULT 0
            )
        """))
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_mesh_conflicts_open
            ON mesh_conflicts (resolved, created_at)
        """))
        await db.commit()


def _enc(v: Any) -> str | None:
    if v is None:
        return None
    return v if isinstance(v, str) else json.dumps(v, default=str)


async def open_conflicts(limit: int = 200) -> list[dict[str, Any]]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("""
                SELECT id, batch_id, peer, tbl, row_id, field,
                       local_value, remote_value, base_value, created_at
                FROM mesh_conflicts WHERE resolved = 0
                ORDER BY created_at DESC LIMIT :l
            """),
            {"l": limit},
        )
        return [
            {"id": r[0], "batch_id": r[1], "peer": r[2], "tbl": r[3], "row_id": r[4],
             "field": r[5], "local_value": r[6], "remote_value": r[7],
             "base_value": r[8], "created_at": r[9]}
            for r in result.fetchall()
        ]


async def apply_rows(
    rows: list[dict[str, Any]],
    *,
    peer: str,
    batch_id: str | None = None,
    take_snapshot: bool = True,
) -> ApplyReport:
    """Merge a peer's rows into this library.

    `rows` is what the wire delivered: `{tbl, row_id, hlc, values}` per row, with
    `values=None` meaning the peer deleted it.
    """
    batch_id = batch_id or f"sync-{uuid.uuid4().hex[:8]}"
    report = ApplyReport(batch_id=batch_id)
    if not rows:
        return report

    if take_snapshot:
        journal.take_snapshot(f"before-{batch_id}")

    entries: list[dict[str, Any]] = []
    conflict_rows: list[dict[str, Any]] = []

    for incoming in rows:
        tbl = incoming.get("tbl")
        row_id = incoming.get("row_id")
        if not isinstance(tbl, str) or not isinstance(row_id, str):
            report.skipped.append(f"malformed row {incoming!r:.60}")
            continue
        if not rowstore.is_syncable(tbl):
            # A peer naming a table we do not sync is either a version skew or
            # something hostile. Either way it is refused, never written.
            report.skipped.append(f"{tbl} is not a synced table")
            continue

        remote_hlc = incoming.get("hlc")
        if tbl in LINK_TABLES:
            await _apply_link(tbl, row_id, incoming, peer, batch_id, remote_hlc,
                              entries, report)
            continue

        await _apply_row(tbl, row_id, incoming, peer, batch_id, remote_hlc,
                         entries, conflict_rows, report)

    await journal.record_many(entries)
    await _record_conflicts(conflict_rows)
    report.conflicts = len(conflict_rows)

    if remote_max := max((r.get("hlc") or "" for r in rows), default=""):
        # Everything this peer sent is now accounted for, so our clock must sort
        # after it — otherwise our next edit would look older than a change we
        # have already applied and lose a conflict it should win (§5).
        try:
            await clock.observe(remote_max)
        except ValueError:
            logger.warning("mesh: peer sent an unparseable stamp; clock not advanced")

    return report


async def _apply_row(tbl, row_id, incoming, peer, batch_id, remote_hlc,
                     entries, conflict_rows, report) -> None:
    local = await rowstore.read_row(tbl, row_id)
    base = await rowstore.get_base(tbl, row_id)
    remote = incoming.get("values")

    result = merge.merge_row(
        local=local, remote=remote, base=base,
        local_hlc=(base or {}).get("__hlc"), remote_hlc=remote_hlc,
    )

    conflicted = {c.field for c in result.conflicts}
    for c in result.conflicts:
        conflict_rows.append({
            "batch_id": batch_id, "peer": peer, "tbl": tbl, "row_id": row_id,
            "field": c.field, "local_value": c.local_value,
            "remote_value": c.remote_value, "base_value": c.base_value,
        })

    # Only fields that actually change are written, and conflicted fields are
    # left exactly as they are — the user has not decided yet.
    changed = {
        k: v for k, v in result.values.items()
        if k not in conflicted and (local is None or local.get(k) != v)
    }
    if changed:
        written = await rowstore.apply_values(tbl, row_id, changed)
        report.fields_written += written
        report.rows_applied += 1
        for k, v in changed.items():
            entries.append({
                "batch_id": batch_id, "peer": peer, "tbl": tbl, "row_id": row_id,
                "field": k, "old_value": (local or {}).get(k), "new_value": v,
                "rule": result.rules.get(k, merge.RULE_LWW),
            })

    # The base only advances over what is settled. A conflicted field keeps its
    # old base so the next sync still sees the disagreement.
    settled = {k: v for k, v in result.values.items() if k not in conflicted}
    if settled:
        merged_base = dict(base or {})
        merged_base.update(settled)
        if remote_hlc:
            merged_base["__hlc"] = remote_hlc
        await rowstore.set_base(tbl, row_id, merged_base, remote_hlc)


async def _apply_link(tbl, row_id, incoming, peer, batch_id, remote_hlc,
                      entries, report) -> None:
    remote_present = bool(incoming.get("present", incoming.get("values") is not None))
    local_present = await rowstore.link_present(tbl, row_id)
    base = await rowstore.get_base(tbl, row_id) or {}

    present, rule = merge.merge_link(
        local_present=local_present, remote_present=remote_present,
        local_hlc=base.get("__hlc"), remote_hlc=remote_hlc,
    )
    if present != local_present and await rowstore.set_link(tbl, row_id, present):
        report.rows_applied += 1
        report.fields_written += 1
        entries.append({
            "batch_id": batch_id, "peer": peer, "tbl": tbl, "row_id": row_id,
            "field": "present", "old_value": local_present, "new_value": present,
            "rule": rule,
        })
    await rowstore.set_base(tbl, row_id, {"present": present, "__hlc": remote_hlc},
                            remote_hlc)


async def _record_conflicts(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    from datetime import datetime

    now = datetime.utcnow().isoformat() + "Z"
    async with AsyncSessionLocal() as db:
        for r in rows:
            await db.execute(
                text("""
                    INSERT INTO mesh_conflicts
                        (id, batch_id, peer, tbl, row_id, field,
                         local_value, remote_value, base_value, created_at)
                    VALUES (:id, :b, :p, :t, :r, :f, :lv, :rv, :bv, :ts)
                """),
                {
                    "id": uuid.uuid4().hex, "b": r["batch_id"], "p": r["peer"],
                    "t": r["tbl"], "r": r["row_id"], "f": r["field"],
                    "lv": _enc(r["local_value"]), "rv": _enc(r["remote_value"]),
                    "bv": _enc(r["base_value"]), "ts": now,
                },
            )
        await db.commit()


async def export_rows(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Turn change-log entries into rows for the wire.

    Deduplicated by (tbl, row_id): a memo edited ten times ships once, because
    what travels is the current state, not the history of getting there.
    """
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    for e in entries:
        tbl, row_id = e.get("tbl"), e.get("row_id")
        if not rowstore.is_syncable(tbl or ""):
            continue
        seen[(tbl, row_id)] = e

    out: list[dict[str, Any]] = []
    for (tbl, row_id), e in seen.items():
        if tbl in LINK_TABLES:
            out.append({
                "tbl": tbl, "row_id": row_id, "hlc": e.get("hlc"),
                "present": await rowstore.link_present(tbl, row_id),
            })
            continue
        values = await rowstore.read_row(tbl, row_id)
        if values is not None:
            values = {k: v for k, v in values.items() if k not in merge.LOCAL_ONLY}
        out.append({"tbl": tbl, "row_id": row_id, "hlc": e.get("hlc"), "values": values})
    return out


# ── resolving (§7) ───────────────────────────────────────────────────────────

KEEP_LOCAL = "local"
KEEP_REMOTE = "remote"
KEEP_BOTH = "both"


async def resolve_conflict(conflict_id: str, choice: str, *, peer: str = "you") -> dict[str, Any]:
    """Apply the user's decision to one parked conflict.

    `both` is the default in the UI and the safest outcome: the winner takes the
    field and the loser is preserved as a copy, so a wrong click costs a tidy-up
    rather than someone's writing. Never silently discard what a human typed.
    """
    if choice not in (KEEP_LOCAL, KEEP_REMOTE, KEEP_BOTH):
        raise ValueError(f"unknown choice {choice!r}")

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("""SELECT batch_id, peer, tbl, row_id, field, local_value,
                           remote_value, base_value
                    FROM mesh_conflicts WHERE id = :i AND resolved = 0"""),
            {"i": conflict_id},
        )).first()
    if row is None:
        return {"ok": False, "reason": "already resolved or unknown"}

    batch_id, origin_peer, tbl, row_id, field, local_v, remote_v, _base = row
    winner = local_v if choice == KEEP_LOCAL else remote_v
    resolve_batch = f"resolve-{uuid.uuid4().hex[:8]}"
    entries: list[dict[str, Any]] = []
    copy_id: str | None = None

    if choice == KEEP_BOTH:
        # Keep the remote text on the row and preserve the local one beside it,
        # rather than making the user copy it out of a dialogue before deciding.
        winner = remote_v
        copy_id = await _keep_losing_copy(tbl, row_id, field, local_v, origin_peer)

    current = await rowstore.read_row(tbl, row_id)
    if current is not None and current.get(field) != winner:
        await rowstore.apply_values(tbl, row_id, {field: winner})
        entries.append({
            "batch_id": resolve_batch, "peer": peer, "tbl": tbl, "row_id": row_id,
            "field": field, "old_value": current.get(field), "new_value": winner,
            "rule": f"user-choice:{choice}",
        })

    await journal.record_many(entries)

    # The disagreement is settled, so the base may finally advance over it —
    # otherwise the next sync would raise the same conflict again.
    base = await rowstore.get_base(tbl, row_id) or {}
    base[field] = winner
    await rowstore.set_base(tbl, row_id, base, base.get("__hlc"))
    await clock.tick()

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE mesh_conflicts SET resolved = 1 WHERE id = :i"),
            {"i": conflict_id},
        )
        await db.commit()

    return {"ok": True, "choice": choice, "copy_id": copy_id, "batch_id": resolve_batch}


async def _keep_losing_copy(tbl, row_id, field, value, origin_peer) -> str | None:
    """Preserve the losing text so 'keep both' actually keeps both.

    Only memos can hold a copy — for anything else the value still survives in
    the journal, and inventing a duplicate collection would be worse than the
    problem it solves.
    """
    if tbl != "memos" or value in (None, ""):
        return None

    original = await rowstore.read_row("memos", row_id)
    if original is None:
        return None

    copy_id = str(uuid.uuid4())

    # Build the row first, THEN stamp the title. When the contested field IS the
    # title, setting them in one dict literal silently drops the provenance
    # marker — the losing value overwrote it — and the copy became
    # indistinguishable from an ordinary memo.
    values: dict[str, Any] = {
        "workspace_id": original.get("workspace_id"),
        "type": original.get("type") or "note",
        "notes": original.get("notes"),
        field: value,
    }
    base_title = value if field == "title" else (original.get("title") or "Memo")
    values["title"] = f"{base_title} (from {origin_peer})"

    await rowstore.apply_values("memos", copy_id, values)
    return copy_id


async def resolve_all(choice: str, *, peer: str = "you") -> int:
    """Apply one decision to every open conflict — the 'do the same for the
    other 6' path (§7). Forty conflicts from a mass import is one decision."""
    resolved = 0
    for c in await open_conflicts(limit=1000):
        result = await resolve_conflict(c["id"], choice, peer=peer)
        resolved += 1 if result.get("ok") else 0
    return resolved
