"""User-configurable runtime settings, persisted as JSON.

Kept separate from `backend/config.py` (env/static config). This holds the
handful of values a user can change from the Settings page at runtime, e.g.
the maximum upload size. Stored at DATA_DIR/app_settings.json.
"""

import hashlib
import hmac
import json
import secrets
import threading
from pathlib import Path
from typing import Any

from backend.config import settings

_PATH = Path(settings.DATA_DIR) / "app_settings.json"
# yt-dlp cookie jar (Netscape cookies.txt). Used to download age-restricted /
# private / login-gated sources via "Make it local". This is account
# credentials — kept under DATA_DIR (gitignored), never logged, never returned
# over the API; only its PRESENCE is exposed (see `cookies_present`).
_COOKIES_PATH = Path(settings.DATA_DIR) / "yt_cookies.txt"
# Custom appearance background. Stored full-quality server-side (not a
# localStorage data URL, which can't hold a real photo) and served back by the
# settings API. The filename keeps the uploaded extension; the active one is
# tracked in app_settings under `bg_image_ext`.
_BG_DIR = Path(settings.DATA_DIR)
_LOCK = threading.Lock()

# Defaults. max_upload_mb default = 5 GB. 0 means uncapped (local-first app —
# the user owns the disk, they decide). Hard ceiling is 1 TB so a bug-typed
# value can't pin a uvicorn worker into a multi-petabyte read loop.
_DEFAULTS: dict[str, Any] = {
    "max_upload_mb": 5 * 1024,
    # Profile — displayed in the sidebar foot and used to address the user
    # in copy. Avatar is a small data URL (resized client-side) so the
    # server never has to host static user images.
    "display_name": "",
    "email": "",
    "avatar_data_url": "",
    # Opt-in for the creator's personal updates / new-app mailing list.
    # Stored as a plain boolean — there is NO automatic outbound delivery
    # from this app; the creator inspects DATA_DIR/app_settings.json.
    "mailing_list_consent": False,
    # Auto-download audio pulled from yt-dlp platforms (SoundCloud, Bandcamp,
    # etc.) on ingest, so it becomes a local playable memo with no manual
    # "Make it local" step. When False, the memo stays remote and the detail
    # page streams it via the platform's embed widget instead.
    "auto_download_audio": True,
    # Extension (without dot) of the active custom background image, e.g. "jpg".
    # Empty = no custom background. The file lives at DATA_DIR/background.<ext>.
    "bg_image_ext": "",
}

_UNCAPPED_SENTINEL = 0
_HARD_CEILING_MB = 1024 * 1024  # 1 TB

# Hidden-section passcode (OPNMMO-0016). Stored as "salt$hash" (hex,
# PBKDF2-HMAC-SHA256) in the same JSON file but deliberately NOT in _DEFAULTS:
# get_settings() strips it so the hash never crosses the API — only the
# boolean `hidden_passcode_set` does. This is a soft privacy gate for the UI
# (the local API itself has no auth), not an encryption boundary.
_PASSCODE_KEY = "hidden_passcode_hash"
_PBKDF2_ITERATIONS = 200_000


def _read() -> dict[str, Any]:
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {**_DEFAULTS, **data}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return dict(_DEFAULTS)


def get_settings() -> dict[str, Any]:
    # `yt_cookies_present` is computed from disk, never persisted in the JSON —
    # so the UI can show cookie status without ever exposing the jar itself.
    # The hidden-section passcode hash is likewise stripped: the API only ever
    # sees whether a passcode exists.
    data = _read()
    data.pop(_PASSCODE_KEY, None)
    return {
        **data,
        "yt_cookies_present": cookies_present(),
        "hidden_passcode_set": hidden_passcode_set(),
    }


def get_cookies_path() -> Path:
    """Path to the yt-dlp cookie jar (may not exist)."""
    return _COOKIES_PATH


def cookies_present() -> bool:
    return _COOKIES_PATH.is_file() and _COOKIES_PATH.stat().st_size > 0


def save_cookies(text: str) -> None:
    """Atomically write the cookie jar to disk (tmp + replace)."""
    with _LOCK:
        _COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _COOKIES_PATH.with_suffix(".txt.tmp")
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        tmp.replace(_COOKIES_PATH)


def delete_cookies() -> None:
    with _LOCK:
        _COOKIES_PATH.unlink(missing_ok=True)


def get_background_path() -> Path | None:
    """Path to the active custom background image, or None if unset/missing."""
    ext = (_read().get("bg_image_ext") or "").lstrip(".")
    if not ext:
        return None
    p = _BG_DIR / f"background.{ext}"
    return p if p.is_file() else None


def background_present() -> bool:
    return get_background_path() is not None


def save_background(raw: bytes, ext: str) -> None:
    """Store the background image full-quality (tmp + replace), drop any prior
    file with a different extension, and record the active extension."""
    ext = ext.lstrip(".").lower()
    with _LOCK:
        _BG_DIR.mkdir(parents=True, exist_ok=True)
        # Remove a previous background of a different extension so only one exists.
        prev = (_read().get("bg_image_ext") or "").lstrip(".")
        if prev and prev != ext:
            (_BG_DIR / f"background.{prev}").unlink(missing_ok=True)
        dest = _BG_DIR / f"background.{ext}"
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        with open(tmp, "wb") as f:
            f.write(raw)
        tmp.replace(dest)
    update_settings({"bg_image_ext": ext})


def delete_background() -> None:
    with _LOCK:
        ext = (_read().get("bg_image_ext") or "").lstrip(".")
        if ext:
            (_BG_DIR / f"background.{ext}").unlink(missing_ok=True)
    update_settings({"bg_image_ext": ""})


def _write_raw(data: dict[str, Any]) -> None:
    """Atomically persist the full settings dict (caller holds _LOCK)."""
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    tmp.replace(_PATH)


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a patch into persisted settings. Only known keys are kept."""
    with _LOCK:
        current = _read()
        for key, val in patch.items():
            if key in _DEFAULTS:
                current[key] = val
        _write_raw(current)
        return current


def hidden_passcode_set() -> bool:
    return bool(_read().get(_PASSCODE_KEY))


def set_hidden_passcode(passcode: str) -> None:
    """Hash and store the hidden-section passcode (salt$hash, PBKDF2)."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", passcode.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    ).hex()
    with _LOCK:
        current = _read()
        current[_PASSCODE_KEY] = f"{salt}${digest}"
        _write_raw(current)


def verify_hidden_passcode(passcode: str) -> bool:
    stored = _read().get(_PASSCODE_KEY) or ""
    if "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    try:
        candidate = hashlib.pbkdf2_hmac(
            "sha256", passcode.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
        ).hex()
    except ValueError:
        return False
    return hmac.compare_digest(candidate, digest)


def get_max_upload_bytes() -> int:
    """Return the per-file upload cap in bytes.

    A value of 0 (or negative) is interpreted as uncapped; the handler will
    only stop when disk is full. Otherwise clamp to [1 MB .. 1 TB] so a typo
    in the JSON file can't break the server.
    """
    mb = _read().get("max_upload_mb", _DEFAULTS["max_upload_mb"])
    try:
        mb = int(mb)
    except (TypeError, ValueError):
        mb = _DEFAULTS["max_upload_mb"]
    if mb <= _UNCAPPED_SENTINEL:
        return _HARD_CEILING_MB * 1024 * 1024
    mb = max(1, min(mb, _HARD_CEILING_MB))
    return mb * 1024 * 1024
