"""Magnet records and the fetch policy (ADR-024 §1, §8).

A magnet says *what a file is* and *every way to get it*, in a few hundred
bytes. It travels as ordinary metadata, so the other device can fetch the file
itself instead of us shipping 24 GB across the wire.

Measured on the live library: 23.66 GB refetchable, 1.58 GB that exists nowhere
else. So the peer is the **last** source for most things and the **only** source
for the handful that matter most — voice memos, screenshots, uploads.

Two things here are not media and do not follow that rule:

* **Covers** (`space_covers/`, `playlist_covers/`) have no source to refetch
  from and are structural, so they transfer eagerly and first. A Space without
  its cover looks broken in a way a track without audio does not.
* **Structure itself** — Spaces, collections, playlists, hidden, ordering — is
  rows, not files, so it arrives in the metadata lane before any of this runs.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import text

from backend.config import settings
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# How many recent memos get their media fetched eagerly on a fresh device.
# Enough that the library is immediately useful; small enough that pairing is
# not a 24 GB event (§1 fetch policy).
EAGER_RECENT = 20

FETCH_RECENT = "recent"        # default: 20 newest, then fill in gradually
FETCH_EVERYTHING = "everything"
FETCH_ON_OPEN = "on_open"

# Priority ladder handed to the job queue (§9). Lower runs first.
PRIORITY_COVER = 5        # structure. Ahead of everything.
PRIORITY_OPENED = 0       # the user is looking at it right now
PRIORITY_RECENT = 20
PRIORITY_BACKFILL = 100


@dataclass
class Source:
    kind: str                     # qobuz | origin | peer
    url: str | None = None
    quality: str | None = None
    device: str | None = None


@dataclass
class Magnet:
    blob: str                     # the filename, which is a uuid
    bytes: int | None = None
    sha256: str | None = None
    sources: list[Source] = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @staticmethod
    def from_json(raw: str | None) -> "Magnet | None":
        if not raw:
            return None
        try:
            data = json.loads(raw)
            return Magnet(
                blob=data["blob"],
                bytes=data.get("bytes"),
                sha256=data.get("sha256"),
                sources=[Source(**s) for s in data.get("sources", [])],
            )
        except (ValueError, KeyError, TypeError):
            return None


def build_for_memo(row: dict[str, Any], *, provider: str | None = None,
                   quality: str | None = None) -> Magnet | None:
    """Derive a magnet from a memo row. None when there is no file to describe.

    Source order encodes the preference: the best-quality provider first, the
    original link second, the peer last. A memo with no `source_url` gets only
    the peer — which is correct, and is exactly the 1.58 GB that has to cross.
    """
    file_path = row.get("file_path")
    if not file_path:
        return None

    blob = Path(str(file_path).replace("\\", "/")).name
    if not blob:
        return None

    sources: list[Source] = []
    source_url = row.get("source_url")

    if source_url and row.get("type") == "audio" and row.get("audio_kind") == "music":
        # SpotiFLAC can usually find a better master than the original link.
        if provider:
            sources.append(Source(kind=provider, url=source_url, quality=quality))
    if source_url:
        sources.append(Source(kind="origin", url=source_url))

    # Always last, always present. A dead source must never mean losing media
    # the other machine still has (§1).
    sources.append(Source(kind="peer"))

    return Magnet(blob=blob, sources=sources)


async def create_table() -> None:
    """Magnets live beside the memo rather than on it.

    A separate table on purpose: `memos` is already 39 columns, the magnet is
    derived data that can be rebuilt, and keeping it out means adding one does
    not force a migration on a table the whole app reads.
    """
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_magnets (
                memo_id  TEXT PRIMARY KEY,
                magnet   TEXT NOT NULL,
                updated  TEXT
            )
        """))
        await db.commit()


async def put(memo_id: str, magnet: Magnet) -> None:
    from datetime import datetime

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO mesh_magnets (memo_id, magnet, updated)
                VALUES (:i, :m, :t)
                ON CONFLICT (memo_id) DO UPDATE SET magnet = :m, updated = :t
            """),
            {"i": memo_id, "m": magnet.to_json(), "t": datetime.utcnow().isoformat() + "Z"},
        )
        await db.commit()


async def get(memo_id: str) -> Magnet | None:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT magnet FROM mesh_magnets WHERE memo_id = :i"), {"i": memo_id}
        )).first()
    return Magnet.from_json(row[0]) if row else None


async def backfill(limit: int | None = None) -> int:
    """Give every existing memo with a file a magnet.

    Runs once when Mesh is first enabled. Reads the provider and quality the
    user has configured, so a magnet describes how *this* library fetches music
    rather than a hardcoded default.
    """
    from backend.core.app_settings import get_settings

    cfg = get_settings()
    provider = cfg.get("music_provider") or None
    quality = str(cfg.get("music_quality") or "") or None

    async with AsyncSessionLocal() as db:
        result = await db.execute(text("""
            SELECT m.id, m.file_path, m.source_url, m.type, m.audio_kind
            FROM memos m
            LEFT JOIN mesh_magnets g ON g.memo_id = m.id
            WHERE m.file_path IS NOT NULL AND m.file_path != ''
              -- COALESCE, not `= 0`: a row with NULL is_deleted would be
              -- silently excluded, because NULL = 0 is NULL rather than
              -- false. Legacy rows predating the column can look like that.
              AND COALESCE(m.is_deleted, 0) = 0 AND g.memo_id IS NULL
        """))
        rows = result.fetchall()

    made = 0
    for r in rows[: limit or len(rows)]:
        magnet = build_for_memo(
            {"file_path": r[1], "source_url": r[2], "type": r[3], "audio_kind": r[4]},
            provider=provider, quality=quality,
        )
        if magnet:
            await put(r[0], magnet)
            made += 1
    if made:
        logger.info("mesh: built %d magnet(s) for existing memos", made)
    return made


# ── covers: structural, irreplaceable, eager (§1) ────────────────────────────

COVER_DIRS = {
    "workspaces": "space_covers",
    "collections": "playlist_covers",
}


def cover_path(tbl: str, row_id: str, ext: str) -> Path | None:
    """Where a cover lives on this disk. None for a table that has no covers."""
    folder = COVER_DIRS.get(tbl)
    if not folder or not ext:
        return None
    return Path(settings.DATA_DIR) / folder / f"{row_id}.{ext.lstrip('.')}"


async def missing_covers() -> list[dict[str, str]]:
    """Rows whose cover this device does not have yet.

    These have no source to refetch from — a cover someone cropped and
    positioned exists nowhere else — so they are fetched from the peer directly,
    ahead of all media.
    """
    out: list[dict[str, str]] = []
    async with AsyncSessionLocal() as db:
        for tbl in COVER_DIRS:
            rows = (await db.execute(
                text(f"SELECT id, cover_ext FROM {tbl} "
                     "WHERE cover_ext IS NOT NULL AND cover_ext != ''")
            )).fetchall()
            for row_id, ext in rows:
                path = cover_path(tbl, row_id, ext)
                if path is not None and not path.exists():
                    out.append({"tbl": tbl, "row_id": row_id, "ext": ext,
                                "path": str(path)})
    return out


# ── what to fetch, in what order ─────────────────────────────────────────────

async def fetch_plan(policy: str = FETCH_RECENT) -> list[dict[str, Any]]:
    """What this device should pull, most urgent first.

    Covers always lead: a Space without its cover looks broken in a way a track
    without audio does not. Then media, according to the policy.
    """
    plan: list[dict[str, Any]] = [
        {"kind": "cover", "priority": PRIORITY_COVER, **c}
        for c in await missing_covers()
    ]

    if policy == FETCH_ON_OPEN:
        return plan

    limit = "" if policy == FETCH_EVERYTHING else f"LIMIT {EAGER_RECENT}"
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(f"""
            SELECT m.id, g.magnet
            FROM memos m
            JOIN mesh_magnets g ON g.memo_id = m.id
            WHERE COALESCE(m.is_deleted, 0) = 0
              AND (m.file_path IS NULL OR m.file_path = '')
            ORDER BY COALESCE(m.recency_at, m.created_at) DESC
            {limit}
        """))).fetchall()

    for i, (memo_id, raw) in enumerate(rows):
        plan.append({
            "kind": "media",
            "memo_id": memo_id,
            "magnet": raw,
            # The eager window keeps its urgency; everything past it is backfill
            # that must always yield to something the user actually opened.
            "priority": PRIORITY_RECENT if i < EAGER_RECENT else PRIORITY_BACKFILL,
        })
    return plan
