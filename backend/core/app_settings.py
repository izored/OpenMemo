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
    # Auto-download a video that has NO inline embed player (Threads, Reddit, an
    # unknown host) on ingest, via the sniff/yt-dlp helper, so it becomes a local
    # playable memo with no manual "Make it local" step. Embeddable hosts
    # (YouTube, Vimeo, …) are left remote so this never fills the disk. When
    # False, no video is auto-downloaded.
    "auto_download_video": True,
    # Lossless quality for the SpotiFLAC chain (Spotify + Apple Music).
    # Always request hi-res (24-bit); the resolver downgrades to 16-bit CD
    # automatically when a release has no hi-res master (no user setting).
    "music_quality": "24",
    # Preferred lossless source. Only "qobuz" (direct FLAC, no DRM) is wired
    # today; kept as a setting so Tidal/Amazon can be added without a migration.
    "music_provider": "qobuz",
    # Extension (without dot) of the active custom background image, e.g. "jpg".
    # Empty = no custom background. The file lives at DATA_DIR/background.<ext>.
    "bg_image_ext": "",
    # Default Ollama chat model for AI features (Ask Memo, summaries). Empty =
    # fall through to the env default, then to any installed model — see
    # OllamaClient.resolve_chat_model for the full resolution order.
    "chat_model": "",
    # Ollama context window (num_ctx) for chat/summary calls. 0 = use the env
    # default (OLLAMA_NUM_CTX). A user with more RAM can raise it from Settings
    # so long transcripts / full RAG contexts aren't silently truncated; a user
    # on a small box can lower it. Resolved + clamped by get_num_ctx().
    "num_ctx": 0,
    # Telegram capture relay (ADR-020). The poller runs only when enabled AND a
    # bot token is present. Poll cadence in minutes (clamped 1–120 by the
    # relay). Saves land in the named collection (auto-created if missing).
    "telegram_enabled": False,
    "telegram_poll_minutes": 15,
    "telegram_default_collection": "IG Inbox",
    # Pull media locally for every bot save (video/audio download on save,
    # regardless of the embed-host rule) so an on-the-go capture survives
    # takedown without a manual "Make it local" visit. Off = bot saves follow
    # the same auto-download rules as a WebUI paste.
    "telegram_force_localize": True,
    # Mesh (ADR-024): two-way device sync. Off by default and gating EVERY
    # table, trigger, worker, socket and route the feature adds, so an install
    # that never turns it on pays nothing. Read through backend/core/mesh.py,
    # never directly, so there is one switch to reason about.
    "mesh_enabled": False,
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

# Telegram relay secrets (ADR-020). Stored in the same JSON but NOT in
# _DEFAULTS: get_settings() strips them, so the token and the owner's Telegram
# user id never cross the API — only `telegram_token_present` and
# `telegram_user_locked` booleans do (the yt_cookies pattern).
_TG_TOKEN_KEY = "telegram_bot_token"
_TG_USER_KEY = "telegram_allowed_user_id"


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
    data.pop(_TG_TOKEN_KEY, None)
    data.pop(_TG_USER_KEY, None)
    data.pop(_CANARY_KEY, None)
    data.pop(_INTEGRITY_KEY, None)
    return {
        **data,
        "yt_cookies_present": cookies_present(),
        "hidden_passcode_set": hidden_passcode_set(),
        "telegram_token_present": telegram_token_present(),
        "telegram_user_locked": telegram_user_locked(),
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


# Last Instagram canary run (core/canary.py). Persisted in the same JSON but
# deliberately NOT in _DEFAULTS: it is a health RECORD, not a preference, so it
# has no business being writable through the settings API. get_settings()
# strips it; the /instagram/health endpoint is what surfaces it.
_CANARY_KEY = "instagram_canary"


def get_instagram_canary() -> dict | None:
    value = _read().get(_CANARY_KEY)
    return value if isinstance(value, dict) else None


def set_instagram_canary(result: dict) -> None:
    with _LOCK:
        current = _read()
        current[_CANARY_KEY] = result
        _write_raw(current)


# Last library integrity check (core/integrity.py). Same reasoning as the canary
# above: a health record, not a preference, so it is stripped from the settings
# API and surfaced by /library/integrity instead. It is also what the NEXT run
# compares against, which is the whole point — without a stored previous count
# there is no way to tell a known gap from one that just appeared.
_INTEGRITY_KEY = "library_integrity"


def get_library_integrity() -> dict | None:
    value = _read().get(_INTEGRITY_KEY)
    return value if isinstance(value, dict) else None


def set_library_integrity(result: dict) -> None:
    with _LOCK:
        current = _read()
        current[_INTEGRITY_KEY] = result
        _write_raw(current)


def telegram_token_present() -> bool:
    return bool(_read().get(_TG_TOKEN_KEY))


def get_telegram_token() -> str:
    """The raw bot token — for the relay's own API calls only, never the API."""
    return str(_read().get(_TG_TOKEN_KEY) or "")


def set_telegram_token(token: str) -> None:
    """Store (or clear, with an empty string) the Telegram bot token."""
    with _LOCK:
        current = _read()
        if token.strip():
            current[_TG_TOKEN_KEY] = token.strip()
        else:
            current.pop(_TG_TOKEN_KEY, None)
            # A new bot means a new chat: drop the old owner lock with it.
            current.pop(_TG_USER_KEY, None)
        _write_raw(current)


def telegram_user_locked() -> bool:
    return bool(_read().get(_TG_USER_KEY))


def get_telegram_allowed_user() -> int:
    """The locked owner user id, or 0 when not yet captured."""
    try:
        return int(_read().get(_TG_USER_KEY) or 0)
    except (TypeError, ValueError):
        return 0


def set_telegram_allowed_user(user_id: int) -> None:
    """Lock the relay to one Telegram user (0 clears the lock). Auto-captured
    from the first sender after a token is set — see telegram_relay."""
    with _LOCK:
        current = _read()
        if user_id:
            current[_TG_USER_KEY] = int(user_id)
        else:
            current.pop(_TG_USER_KEY, None)
        _write_raw(current)


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


# num_ctx bounds: below the floor Ollama truncates almost everything; above the
# ceiling a typo could exhaust RAM / OOM the model. 128k is the top of current
# local context windows.
_NUM_CTX_FLOOR = 512
_NUM_CTX_CEILING = 131072


def get_num_ctx() -> int:
    """Resolve the Ollama context window (num_ctx) for chat/summary calls.

    A positive runtime override (Settings) wins; otherwise fall back to the
    env/static default (OLLAMA_NUM_CTX). Always clamped to [512, 131072] so a
    bad value in the JSON can't wedge Ollama.
    """
    raw = _read().get("num_ctx", 0)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 0
    if n <= 0:
        n = settings.OLLAMA_NUM_CTX
    return max(_NUM_CTX_FLOOR, min(n, _NUM_CTX_CEILING))
