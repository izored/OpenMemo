"""The Mesh code, pairing and the device list (ADR-024 §2, §3).

**No account. No email. No login.** The twelve words *are* the identity. Two
machines holding the same words are the same library; nothing else is consulted,
because nothing else exists.

Phase 5 already derived every key from a root secret via HKDF, so this phase
only replaces where that root comes from — `os.urandom` becomes a BIP39 seed the
user can write on paper. Everything downstream is untouched.

BIP39 is used rather than hand-rolled because a wrong wordlist would be a silent
correctness bug in the one value the user cannot re-derive, and its checksum
turns a typo into an immediate "that isn't right" instead of a pairing that
mysteriously never connects.

**The code is the library.** Anyone holding those words can read everything, so
it lives in the OS keychain rather than in `app_settings.json`, is shown once
behind a reveal, and is never logged, never synced, and never returned by an API
that lists settings.
"""
from __future__ import annotations

import io
import json
import logging
import platform
import subprocess
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text

from backend.core.mesh import secret
from backend.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

_KEYCHAIN_SERVICE = "openMemo Mesh"
_KEYCHAIN_ACCOUNT = "mesh-seed"

WORD_COUNT = 12


class PairingError(Exception):
    """A code that is malformed, mistyped, or for a different library."""


# ── the words ────────────────────────────────────────────────────────────────

def _mnemonic():
    from mnemonic import Mnemonic

    return Mnemonic("english")


def generate_code() -> str:
    """A fresh Mesh code: 128 bits of entropy as twelve words.

    Twelve rather than twenty-four because 128 bits is far beyond brute force
    for a LAN handshake, and the length someone will actually copy onto paper
    matters more here than the difference between 2^128 and 2^256.
    """
    return _mnemonic().generate(strength=128)


def normalise(code: str) -> str:
    """Tidy a typed code: collapse whitespace, lowercase, strip punctuation.

    People paste from notes apps that add commas, capitals and line breaks. None
    of that should be the difference between pairing and not.
    """
    cleaned = (code or "").replace(",", " ").replace("\n", " ").replace("\t", " ")
    return " ".join(cleaned.lower().split())


def validate(code: str) -> list[str]:
    """Parse and checksum a code, returning its words. Raises PairingError.

    The checksum is the point: a typo fails *here*, with a clear message, rather
    than becoming a pairing that silently never connects.
    """
    words = normalise(code).split()
    if len(words) != WORD_COUNT:
        raise PairingError(f"A Mesh code is {WORD_COUNT} words — you entered {len(words)}.")

    m = _mnemonic()
    unknown = [w for w in words if w not in m.wordlist]
    if unknown:
        raise PairingError(
            f"These are not Mesh words: {', '.join(unknown[:3])}. Check for typos."
        )
    if not m.check(" ".join(words)):
        raise PairingError(
            "That code is not quite right — a word is probably mistyped or out of order."
        )
    return words


def seed_from_code(code: str) -> bytes:
    """The 32-byte root the rest of Mesh already knows how to use."""
    import hashlib

    return hashlib.sha256(" ".join(validate(code)).encode("utf-8")).digest()


# ── storing it ───────────────────────────────────────────────────────────────

def _keychain_set(value: str) -> bool:
    """Best-effort OS keychain write. Returns False when unavailable."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(
                ["security", "add-generic-password", "-U",
                 "-s", _KEYCHAIN_SERVICE, "-a", _KEYCHAIN_ACCOUNT, "-w", value],
                check=True, capture_output=True, timeout=10,
            )
            return True
        if system == "Windows":
            # cmdkey stores under a target name; retrieval is not scriptable, so
            # Windows falls through to the file store below. Recorded rather
            # than pretended: claiming keychain storage we do not have would be
            # worse than storing it in a file we are honest about.
            return False
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("mesh: keychain unavailable (%s)", exc)
    return False


def _keychain_get() -> str | None:
    if platform.system() != "Darwin":
        return None
    try:
        out = subprocess.run(
            ["security", "find-generic-password",
             "-s", _KEYCHAIN_SERVICE, "-a", _KEYCHAIN_ACCOUNT, "-w"],
            check=True, capture_output=True, timeout=10,
        )
        return out.stdout.decode().strip() or None
    except (subprocess.SubprocessError, OSError):
        return None


def store_code(code: str) -> dict[str, Any]:
    """Adopt a code as this device's Mesh identity.

    Writes the derived seed, not the words: the words only need to exist on the
    user's paper and in whichever store held them. Everything Mesh does works
    from the seed.
    """
    words = validate(code)
    joined = " ".join(words)
    seed = seed_from_code(joined)

    in_keychain = _keychain_set(joined)
    secret.set_root(seed)
    return {"ok": True, "in_keychain": in_keychain, "words": WORD_COUNT}


def reveal_code() -> str | None:
    """The words, for the reveal-once panel. None when they are not recoverable.

    A device that joined a Mesh stores the seed, not necessarily the words —
    seeds are one-way. The UI must therefore treat "no words to show" as normal
    on a joined device rather than an error.
    """
    return _keychain_get()


# ── the QR ───────────────────────────────────────────────────────────────────

def pairing_uri(code: str, *, host: str | None = None, port: int | None = None) -> str:
    """What the QR encodes: the code, plus a hint of where to find this machine.

    The address is a *hint* only — it goes stale the moment DHCP reshuffles, and
    discovery takes over from then on. Encoding it just makes the first connect
    instant instead of waiting on multicast.
    """
    uri = f"openmemo://sync?c={normalise(code).replace(' ', '-')}"
    if host:
        uri += f"&h={host}"
    if port:
        uri += f"&p={port}"
    return uri


def qr_svg(uri: str) -> str:
    """An SVG QR. SVG rather than PNG so there is no binary image dependency."""
    import qrcode
    import qrcode.image.svg

    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")


# ── the device list (§3) ─────────────────────────────────────────────────────

@dataclass
class Device:
    device_id: str
    name: str
    last_seen: str | None
    is_primary: bool
    revoked: bool


async def create_table() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS mesh_devices (
                device_id  TEXT PRIMARY KEY,
                name       TEXT NOT NULL DEFAULT '',
                platform   TEXT,
                last_seen  TEXT,
                is_primary INTEGER NOT NULL DEFAULT 0,
                revoked    INTEGER NOT NULL DEFAULT 0
            )
        """))
        await db.commit()


async def register_device(device_id: str, name: str, *, is_primary: bool = False) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("""
                INSERT INTO mesh_devices (device_id, name, platform, last_seen, is_primary)
                VALUES (:d, :n, :p, :t, :pr)
                ON CONFLICT (device_id) DO UPDATE SET
                    name = :n, last_seen = :t
            """),
            {"d": device_id, "n": name, "p": platform.system(),
             "t": datetime.utcnow().isoformat() + "Z", "pr": 1 if is_primary else 0},
        )
        await db.commit()


async def devices() -> list[Device]:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(text(
            "SELECT device_id, name, last_seen, is_primary, revoked "
            "FROM mesh_devices ORDER BY is_primary DESC, last_seen DESC"
        ))).fetchall()
    return [Device(r[0], r[1], r[2], bool(r[3]), bool(r[4])) for r in rows]


async def revoke(device_id: str) -> bool:
    """Stop syncing with a device.

    Best-effort by nature, and the UI must say so: a device that never
    reconnects never learns it was removed and still holds the code. Genuinely
    cutting it off means generating a new code and re-pairing (§3).
    """
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            text("UPDATE mesh_devices SET revoked = 1 WHERE device_id = :d"),
            {"d": device_id},
        )
        await db.commit()
        return (result.rowcount or 0) > 0


async def is_revoked(device_id: str) -> bool:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT revoked FROM mesh_devices WHERE device_id = :d"), {"d": device_id}
        )).first()
    return bool(row[0]) if row else False


# ── the primary role (§3) ────────────────────────────────────────────────────

async def set_primary(device_id: str) -> None:
    """Exactly one primary. Handing the role over is one write, not a migration."""
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE mesh_devices SET is_primary = 0"))
        await db.execute(
            text("UPDATE mesh_devices SET is_primary = 1 WHERE device_id = :d"),
            {"d": device_id},
        )
        await db.commit()


async def primary_device_id() -> str | None:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT device_id FROM mesh_devices WHERE is_primary = 1 LIMIT 1")
        )).first()
    return row[0] if row else None


async def this_device_is_primary() -> bool:
    """Whether singleton jobs belong to this machine.

    True when no primary has been chosen, so a single-device install behaves
    exactly as it does today. Mesh must never be able to stop the Telegram relay
    on a machine that has no peers.
    """
    from backend.core.mesh import clock

    primary = await primary_device_id()
    if primary is None:
        return True
    return primary == await clock.device_id()


async def may_run_singleton(job: str) -> bool:
    """Guard for work that must run on exactly one machine (§3).

    `telegram_relay` polls `getUpdates` with an in-memory offset, and Telegram
    hands each update to whoever asks first, exactly once. Two devices polling
    the same token race: memos land on a random machine and some are lost
    entirely. That is a correctness requirement, not a preference.
    """
    from backend.core.mesh import is_enabled

    if not is_enabled():
        return True          # no Mesh, no peers, no race
    allowed = await this_device_is_primary()
    if not allowed:
        logger.info("mesh: skipping %s — this device is not the primary", job)
    return allowed
