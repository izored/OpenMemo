"""Mesh key material (ADR-024 §2).

Phase 5 needs a shared secret before phase 8 turns it into 12 words. The
*derivation* below is already the final design — one root secret, HKDF'd into
separate keys for separate jobs — so phase 8 only replaces where the root comes
from (BIP39 instead of `os.urandom`) and nothing downstream changes.

Separate keys per job, rather than one key used three ways, because reusing key
material across an authenticator and a cipher is how protocols grow subtle
cross-protocol attacks. It costs one HKDF call to never have to think about it.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os

from backend.core.mesh import keystore

logger = logging.getLogger(__name__)

_INFO_CHAIN = b"openmemo/mesh/chain"
_INFO_PSK = b"openmemo/mesh/psk"
_INFO_CONTENT = b"openmemo/mesh/content"

# Server-managed: it is a secret, so it must never be writable or readable
# through the settings API. Stored alongside settings only because that file is
# already outside the synced database — phase 8 moves it to the OS keychain.
SECRET_KEY = "mesh_secret"


def _hkdf(root: bytes, info: bytes, length: int = 32) -> bytes:
    """HKDF-SHA256 (RFC 5869). Extract then expand."""
    prk = hmac.new(b"openmemo-mesh-salt", root, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


def _migrate_out_of_settings() -> str | None:
    """Move a plaintext root out of app_settings.json, once.

    Installs from before the keystore have their root sitting in that file as
    plain hex. Read it, put it where it belongs, and delete the original — a
    migration that copies without deleting leaves the exposure it was written
    to remove.
    """
    from backend.core.app_settings import _LOCK, _read, _write_raw

    with _LOCK:
        current = _read()
        legacy = current.get(SECRET_KEY)
        if not legacy:
            return None
        if keystore.put(SECRET_KEY, legacy):
            current.pop(SECRET_KEY, None)
            _write_raw(current)
            logger.info("mesh: root secret moved into %s", keystore.describe())
        return legacy


def get_or_create_root() -> bytes:
    """The root secret for this library's Mesh. Created on first use.

    Lives in the OS store (core/mesh/keystore.py), not in app_settings.json:
    every Mesh key derives from this, so a copy of it is a copy of the Mesh.
    """
    stored = keystore.get(SECRET_KEY) or _migrate_out_of_settings()
    if not stored:
        stored = os.urandom(32).hex()
        keystore.put(SECRET_KEY, stored)
    return bytes.fromhex(stored)


def set_root(seed: bytes) -> None:
    """Adopt a specific root — how pairing joins an existing Mesh (§2).

    Phase 5 generated a random root; this is the same value arriving from twelve
    words instead. Every derived key below is unchanged, which is why the switch
    from "random secret" to "user's code" touched nothing downstream.
    """
    from backend.core.app_settings import _LOCK, _read, _write_raw

    keystore.put(SECRET_KEY, seed.hex())
    # Clear any pre-keystore copy in the settings file, so joining a Mesh on an
    # install that predates the keystore does not leave the OLD root behind in
    # plaintext next to the new one.
    with _LOCK:
        current = _read()
        if current.pop(SECRET_KEY, None) is not None:
            _write_raw(current)


def reset_root() -> None:
    """Forget the secret, so the next call mints a new one. Unpairs every device."""
    from backend.core.app_settings import _read, _write_raw, _LOCK

    with _LOCK:
        current = _read()
        current.pop(SECRET_KEY, None)
        _write_raw(current)


def chain_id() -> str:
    """Which library this is. Broadcast as a hash, never raw (§2)."""
    return _hkdf(get_or_create_root(), _INFO_CHAIN).hex()


def psk() -> bytes:
    """Authenticates every frame."""
    return _hkdf(get_or_create_root(), _INFO_PSK)


def content_key() -> bytes:
    """Encrypts frame payloads."""
    return _hkdf(get_or_create_root(), _INFO_CONTENT)
