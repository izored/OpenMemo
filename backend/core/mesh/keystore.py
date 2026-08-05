"""Where Mesh key material actually lives (ADR-024 §2).

The root secret every Mesh key derives from used to sit in `app_settings.json`
as plain hex, on every platform, next to the theme and the upload limit. Anything
that could read that file could join the Mesh and decrypt what crossed it — and
for a while `GET /api/settings` handed it out over HTTP.

So: a real store per platform, chosen by what the OS actually offers.

    macOS    the login keychain, via `security`
    Windows  DPAPI (CryptProtectData), tied to the Windows user account
    Linux    a 0600 file, and we say so rather than implying more

Linux is the honest one. There is no keyring guaranteed to exist on a headless
box or in a container, and a dependency that fails at runtime is worse than a
file with the right permissions and a truthful label. `backend()` reports which
of the three answered, so the UI can tell the user where their secret is instead
of implying a uniform guarantee that does not exist.

Encryption at rest only means something if it covers the whole secret. The words
and the seed are the same secret in two forms — either one reconstructs the
Mesh — so both live here or neither does.
"""
from __future__ import annotations

import base64
import logging
import os
import platform
import subprocess
from pathlib import Path

from backend.config import settings

logger = logging.getLogger(__name__)

_SERVICE = "openMemo Mesh"
_DIR_NAME = "mesh"


def _store_dir() -> Path:
    d = Path(settings.DATA_DIR) / _DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass          # Windows ignores POSIX modes; the DPAPI blob is the guard there
    return d


def _path(name: str) -> Path:
    return _store_dir() / f"{name}.bin"


# ── macOS keychain ───────────────────────────────────────────────────────────

def _keychain_set(name: str, value: str) -> bool:
    try:
        subprocess.run(
            ["security", "add-generic-password", "-U",
             "-s", _SERVICE, "-a", name, "-w", value],
            check=True, capture_output=True, timeout=10,
        )
        return True
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("mesh keystore: keychain write failed (%s)", exc)
        return False


def _keychain_get(name: str) -> str | None:
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-s", _SERVICE, "-a", name, "-w"],
            check=True, capture_output=True, timeout=10,
        )
        return out.stdout.decode().strip() or None
    except (subprocess.SubprocessError, OSError):
        return None


def _keychain_delete(name: str) -> None:
    try:
        subprocess.run(
            ["security", "delete-generic-password", "-s", _SERVICE, "-a", name],
            check=False, capture_output=True, timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        pass


# ── Windows DPAPI ────────────────────────────────────────────────────────────
#
# ctypes, not pywin32: DPAPI is in every Windows install and a new dependency
# for three calls would be a worse trade. The ciphertext is bound to the Windows
# user account, so copying the file to another machine or another user yields
# nothing.

def _dpapi(protect: bool, blob: bytes) -> bytes | None:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char))]

        @classmethod
        def of(cls, data: bytes) -> "_BLOB":
            buf = ctypes.create_string_buffer(data, len(data))
            return cls(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))

    fn = (ctypes.windll.crypt32.CryptProtectData if protect
          else ctypes.windll.crypt32.CryptUnprotectData)
    out = _BLOB()
    ok = fn(ctypes.byref(_BLOB.of(blob)), None, None, None, None, 0, ctypes.byref(out))
    if not ok:
        return None
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def _dpapi_set(name: str, value: str) -> bool:
    try:
        sealed = _dpapi(True, value.encode("utf-8"))
        if sealed is None:
            return False
        _path(name).write_bytes(base64.b64encode(sealed))
        return True
    except (OSError, AttributeError) as exc:
        logger.warning("mesh keystore: DPAPI write failed (%s)", exc)
        return False


def _dpapi_get(name: str) -> str | None:
    p = _path(name)
    if not p.is_file():
        return None
    try:
        opened = _dpapi(False, base64.b64decode(p.read_bytes()))
        return opened.decode("utf-8") if opened else None
    except (OSError, ValueError, AttributeError) as exc:
        logger.warning("mesh keystore: DPAPI read failed (%s)", exc)
        return None


# ── plain file, stated plainly ───────────────────────────────────────────────

def _file_set(name: str, value: str) -> bool:
    try:
        p = _path(name)
        p.write_text(value, encoding="utf-8")
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
        return True
    except OSError as exc:
        logger.warning("mesh keystore: file write failed (%s)", exc)
        return False


def _file_get(name: str) -> str | None:
    p = _path(name)
    try:
        return p.read_text(encoding="utf-8").strip() or None
    except (OSError, UnicodeDecodeError):
        return None


# ── the interface everything else uses ───────────────────────────────────────

def backend() -> str:
    """Which store this platform gets: `keychain`, `dpapi` or `file`."""
    system = platform.system()
    if system == "Darwin":
        return "keychain"
    if system == "Windows":
        return "dpapi"
    return "file"


def describe() -> str:
    """One sentence for the UI. It must not overstate what Linux gets."""
    return {
        "keychain": "your macOS login keychain",
        "dpapi": "Windows account encryption (DPAPI), readable only by your user",
        "file": "a file readable only by your user account",
    }[backend()]


def put(name: str, value: str) -> bool:
    """Store a secret. Falls back to the file store if the OS store refuses,
    because losing the Mesh identity is worse than storing it less well — and
    `backend()` still reports what actually happened."""
    kind = backend()
    if kind == "keychain" and _keychain_set(name, value):
        return True
    if kind == "dpapi" and _dpapi_set(name, value):
        return True
    return _file_set(name, value)


def get(name: str) -> str | None:
    """Read a secret, trying every store this platform might have used.

    All three are consulted regardless of platform: an install that fell back to
    the file store once, or moved between them, must still find its own key.
    """
    kind = backend()
    if kind == "keychain":
        found = _keychain_get(name)
        if found:
            return found
    if kind == "dpapi":
        found = _dpapi_get(name)
        if found:
            return found
    return _file_get(name)


def delete(name: str) -> None:
    """Forget a secret everywhere it might be. Used by "Leave this Mesh"."""
    if backend() == "keychain":
        _keychain_delete(name)
    p = _path(name)
    try:
        if p.is_file():
            p.unlink()
    except OSError as exc:
        logger.warning("mesh keystore: could not delete %s (%s)", name, exc)
