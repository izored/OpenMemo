"""Hybrid logical clock (ADR-024 §5).

Two machines, two clocks, drift. Ordering edits by `datetime.utcnow()` means the
laptop whose clock runs three minutes fast wins every conflict, silently. An HLC
fixes that: it tracks wall time when wall time moves forward, and a counter when
it does not, so the order it produces never goes backwards and needs no
coordination between devices.

Format, chosen so a plain string sort equals the logical order:

    0001754092800123-000004-a1b2c3d4
    └── millis ────┘ └cnt┘ └device┘

Both numbers are zero-padded, so lexical comparison works in SQL, in Python, and
in a log file a human is reading. That matters more than compactness here — this
value shows up in the journal (§13) and in conflict dialogues, and being able to
eyeball which of two came first is worth the extra bytes.

The clock itself lives in SQLite (`mesh_clock`), not in this process. The
triggers in `changelog.py` advance it inside the same transaction as the write
they are recording, which is the only way to guarantee the log's order matches
the database's. This module is the Python-side view: parsing, comparison, and
jumping the clock forward when a peer sends us something newer.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import text

from backend.db.database import AsyncSessionLocal

MILLIS_WIDTH = 16
COUNTER_WIDTH = 6

# Device ids we generate are hex, but this value arrives from a peer, so the
# pattern is shape-and-length strict rather than format strict: tight enough to
# reject junk and bound the length, loose enough that changing how ids are
# minted later does not break parsing a peer that still uses the old form.
_HLC_RE = re.compile(r"^(\d{16})-(\d{6})-([0-9A-Za-z_-]{4,32})$")

# SQLite has no millisecond clock built in. julianday() is days since noon
# 4713 BC; 2440587.5 is the Unix epoch in that scale, so this is Unix millis.
SQL_NOW_MILLIS = "CAST((julianday('now') - 2440587.5) * 86400000.0 AS INTEGER)"


@dataclass(frozen=True, order=True)
class HLC:
    """A parsed timestamp. Ordering is by millis, then counter, then device.

    The device tiebreak is what makes the order *total* rather than merely
    partial: two devices can genuinely stamp the same millisecond and counter,
    and a merge needs one of them to win deterministically on both machines. Any
    stable rule works as long as both sides apply the same one.
    """

    millis: int
    counter: int
    device_id: str

    def __str__(self) -> str:
        return f"{self.millis:0{MILLIS_WIDTH}d}-{self.counter:0{COUNTER_WIDTH}d}-{self.device_id}"


def parse(value: str) -> HLC:
    """Parse a stamp. Raises ValueError on anything malformed.

    Deliberately strict: a stamp that does not match is a bug or a hostile peer,
    and silently coercing it would corrupt the ordering that every merge
    decision depends on.
    """
    m = _HLC_RE.match(value or "")
    if not m:
        raise ValueError(f"not a valid HLC: {value!r}")
    return HLC(millis=int(m.group(1)), counter=int(m.group(2)), device_id=m.group(3))


def is_newer(a: str, b: str) -> bool:
    """True when `a` happened after `b`. Both must be valid stamps."""
    return parse(a) > parse(b)


async def create_table() -> None:
    """Create the clock and seed its single row. Idempotent."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_clock (
                id        INTEGER PRIMARY KEY CHECK (id = 1),
                millis    INTEGER NOT NULL DEFAULT 0,
                counter   INTEGER NOT NULL DEFAULT 0,
                device_id TEXT    NOT NULL
            )
        """))
        existing = await db.execute(text("SELECT device_id FROM mesh_clock WHERE id = 1"))
        if existing.first() is None:
            await db.execute(
                text("INSERT INTO mesh_clock (id, millis, counter, device_id) "
                     "VALUES (1, 0, 0, :dev)"),
                {"dev": uuid.uuid4().hex[:8]},
            )
        await db.commit()


async def device_id() -> str:
    """This device's stable id. Generated once, on first use.

    Identifies the *machine*, not the library, and that distinction is
    load-bearing: it is the final tiebreak when two devices stamp the same
    millisecond and counter, so two machines sharing an id would break the total
    order and misattribute every change in the log.

    It therefore must NOT survive being restored onto another machine. Backup
    restore regenerates it (`api/backup.py`) — otherwise restoring one backup
    onto both machines would hand them the same identity.
    """
    await create_table()
    async with AsyncSessionLocal() as db:
        row = (await db.execute(text("SELECT device_id FROM mesh_clock WHERE id = 1"))).first()
        return row[0]


async def tick() -> str:
    """Advance the clock and return the new stamp.

    Used when Python needs a stamp outside a trigger (a merge writing a resolved
    value, a rollback). Same rule the SQL triggers use, so stamps from both paths
    interleave correctly.
    """
    await create_table()
    async with AsyncSessionLocal() as db:
        await db.execute(text(f"""
            UPDATE mesh_clock SET
                counter = CASE WHEN {SQL_NOW_MILLIS} > millis THEN 0 ELSE counter + 1 END,
                millis  = MAX({SQL_NOW_MILLIS}, millis)
            WHERE id = 1
        """))
        row = (await db.execute(
            text("SELECT millis, counter, device_id FROM mesh_clock WHERE id = 1")
        )).first()
        await db.commit()
    return str(HLC(millis=row[0], counter=row[1], device_id=row[2]))


async def observe(remote: str) -> str:
    """Merge a peer's stamp into the local clock, then tick.

    This is the half of an HLC that makes it *logical* rather than just a padded
    wall clock: after seeing a remote event, everything this device stamps
    afterwards sorts after it, even if our own wall clock is behind. Without it,
    a device with a slow clock would keep producing stamps that look older than
    changes it has already seen, and lose conflicts it should win.
    """
    r = parse(remote)
    await create_table()
    async with AsyncSessionLocal() as db:
        await db.execute(
            text(f"""
                UPDATE mesh_clock SET
                    counter = CASE
                        -- Same millisecond on both sides: the counter has to
                        -- clear BOTH, or we can mint a stamp that collides with
                        -- one the peer already used.
                        WHEN millis = :rm AND MAX({SQL_NOW_MILLIS}, millis) = millis
                            THEN MAX(counter, :rc) + 1
                        WHEN MAX({SQL_NOW_MILLIS}, millis, :rm) = millis THEN counter + 1
                        WHEN MAX({SQL_NOW_MILLIS}, millis, :rm) = :rm THEN :rc + 1
                        ELSE 0
                    END,
                    millis = MAX({SQL_NOW_MILLIS}, millis, :rm)
                WHERE id = 1
            """),
            {"rm": r.millis, "rc": r.counter},
        )
        row = (await db.execute(
            text("SELECT millis, counter, device_id FROM mesh_clock WHERE id = 1")
        )).first()
        await db.commit()
    return str(HLC(millis=row[0], counter=row[1], device_id=row[2]))
