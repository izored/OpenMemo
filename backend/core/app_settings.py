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
    return _read()


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
