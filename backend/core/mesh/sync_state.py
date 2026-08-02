"""Turning Mesh on and off (ADR-024 §0).

One place that knows what "enabled" physically means, so the toggle, startup and
the tests all go through the same door rather than each remembering to install
triggers.
"""
from __future__ import annotations

import logging

# Relative imports: the package __init__ imports THIS module, so importing
# it back by absolute path is a cycle that only works by accident of order.
from . import changelog, clock

logger = logging.getLogger(__name__)


async def mesh_schema_init() -> None:
    """Create Mesh's tables. Runs on every boot, enabled or not.

    Empty tables cost nothing and their history must survive a disable, so they
    are created unconditionally. Only the triggers are conditional, because only
    the triggers cost anything per write.
    """
    await clock.create_table()
    await changelog.create_log_table()


async def apply_enabled_state(enabled: bool) -> int:
    """Make the database match the flag. Returns the live trigger count.

    Idempotent in both directions, so it is safe to call on every boot and on
    every toggle without checking what the previous state was.
    """
    if enabled:
        return await changelog.enable_triggers()
    return await changelog.disable_triggers()
