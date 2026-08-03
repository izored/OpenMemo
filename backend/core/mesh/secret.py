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
import os

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


def get_or_create_root() -> bytes:
    """The root secret for this library's Mesh. Created on first use.

    Phase 8 replaces this body with a BIP39 seed the user can write down; every
    caller below stays identical because they only ever see derived keys.
    """
    from backend.core.app_settings import _read, _write_raw, _LOCK

    with _LOCK:
        current = _read()
        stored = current.get(SECRET_KEY)
        if not stored:
            stored = os.urandom(32).hex()
            current[SECRET_KEY] = stored
            _write_raw(current)
    return bytes.fromhex(stored)


def set_root(seed: bytes) -> None:
    """Adopt a specific root — how pairing joins an existing Mesh (§2).

    Phase 5 generated a random root; this is the same value arriving from twelve
    words instead. Every derived key below is unchanged, which is why the switch
    from "random secret" to "user's code" touched nothing downstream.
    """
    from backend.core.app_settings import _LOCK, _read, _write_raw

    with _LOCK:
        current = _read()
        current[SECRET_KEY] = seed.hex()
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
