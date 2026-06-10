"""User-configurable runtime settings, persisted as JSON.

Kept separate from `backend/config.py` (env/static config). This holds the
handful of values a user can change from the Settings page at runtime, e.g.
the maximum upload size. Stored at DATA_DIR/app_settings.json.
"""

import json
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
    return {**_read(), "yt_cookies_present": cookies_present()}


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


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a patch into persisted settings. Only known keys are kept."""
    with _LOCK:
        current = _read()
        for key, val in patch.items():
            if key in _DEFAULTS:
                current[key] = val
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = _PATH.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        tmp.replace(_PATH)
        return current


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
