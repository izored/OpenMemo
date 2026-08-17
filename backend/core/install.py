"""Which shape of openMemo this process is: the Mac app, Docker, or a checkout.

One SPA is served by all three, so any sentence naming a file path, a port, or
an update command is true for exactly one of them. Until this module existed
nothing in the running process could tell them apart, and the copy was hardcoded
wrong in both directions at once: Mac users were told their cookie jar lived in
"a Docker volume" and to run `docker compose up` to update, while Docker users
read that their library "lives on your Mac".

Detection, in order:
  1. `OPENMEMO_INSTALL`, set by the macOS shell when it spawns uvicorn. Explicit
     beats inference, and it is also the override for anyone packaging openMemo
     some other way.
  2. `/.dockerenv`, the marker the container runtime drops in every container.
  3. Otherwise a dev checkout.

The frontend must NOT use this to pick a modifier-key label. This says where the
BACKEND runs; the keyboard belongs to whoever is looking at the page, which can
be a Mac browsing the Docker install. See `frontend/src/lib/install.ts`.
"""
from __future__ import annotations

import os
import platform
from pathlib import Path

KINDS = ("macos", "docker", "dev")


def install_kind() -> str:
    """`macos` | `docker` | `dev`."""
    declared = os.environ.get("OPENMEMO_INSTALL", "").strip().lower()
    if declared in KINDS:
        return declared
    try:
        if Path("/.dockerenv").exists():
            return "docker"
    except OSError:
        pass
    return "dev"


def os_name() -> str:
    """`Darwin` | `Windows` | `Linux`, as the backend process sees it."""
    return platform.system()
