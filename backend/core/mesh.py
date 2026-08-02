"""Mesh feature gate (ADR-024 §0).

Mesh is two-way device sync. Every table, trigger, worker, socket and route it
adds is inert until the user turns it on in Settings → Mesh. That is a hard
requirement, not a courtesy: an unused feature must cost an existing install
exactly nothing.

This module is the single place that answers "is Mesh on?". Every later phase
imports from here rather than reading settings directly, so there is one switch
to reason about and one place to change if the rule ever grows (a kill switch,
an env override, a per-workspace flag).

Deliberately NOT gated: the job queue (`backend/core/jobs.py`). It is ordinary
app infrastructure that fixed a live bug on its own, and Mesh merely becomes
another producer of jobs once enabled.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)

SETTING_KEY = "mesh_enabled"


def is_enabled() -> bool:
    """True when the user has switched Mesh on.

    Reads app settings on every call rather than caching. The read is a small
    JSON file behind a lock, the flag flips rarely, and a stale cache here would
    mean sync quietly continuing after the user turned it off — the one outcome
    worth spending a file read to avoid.
    """
    from backend.core.app_settings import get_settings

    return bool(get_settings().get(SETTING_KEY, False))


async def require_enabled() -> None:
    """FastAPI dependency: 404 every Mesh route while Mesh is off.

    404 rather than 403 on purpose. A disabled feature should be indistinguishable
    from one that was never built — a 403 advertises that the endpoint exists and
    invites probing on a LAN-exposed port.
    """
    if not is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")
