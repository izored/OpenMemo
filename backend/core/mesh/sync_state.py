"""Turning Mesh on and off (ADR-024 §0).

One place that knows what "enabled" physically means, so the toggle, startup and
the tests all go through the same door rather than each remembering to install
triggers.
"""
from __future__ import annotations

import logging

# Relative imports: the package __init__ imports THIS module, so importing
# it back by absolute path is a cycle that only works by accident of order.
from . import (
    apply as apply_mod, changelog, clock, discovery, journal, magnet, pairing,
    rowstore, server,
)

logger = logging.getLogger(__name__)


async def mesh_schema_init() -> None:
    """Create Mesh's tables. Runs on every boot, enabled or not.

    Empty tables cost nothing and their history must survive a disable, so they
    are created unconditionally. Only the triggers are conditional, because only
    the triggers cost anything per write.
    """
    await clock.create_table()
    await changelog.create_log_table()
    await journal.create_table()
    await rowstore.create_table()
    await apply_mod.create_table()
    await magnet.create_table()
    await pairing.create_table()


async def apply_enabled_state(enabled: bool) -> int:
    """Make the machine match the flag. Returns the live trigger count.

    Idempotent in both directions, so it is safe to call on every boot and on
    every toggle without checking what the previous state was.

    Covers both halves of "enabled": the triggers that record changes, and the
    listener that lets a peer reach them. Turning Mesh off must close the port —
    a flag that leaves a socket listening is not off.
    """
    if enabled:
        count = await changelog.enable_triggers()
        await _start_listener()
        await _start_advertising()
        return count

    await discovery.stop_advertising()
    await server.stop()
    return await changelog.disable_triggers()


async def readvertise() -> None:
    """Re-announce after the chain changes.

    Pairing rewrites the root secret, so the fingerprint this machine broadcasts
    changes with it. Advertising once at enable-time leaves both machines
    shouting a stale identity that can never match — which is precisely what the
    convergence harness caught, and what no unit test could have.
    """
    await discovery.stop_advertising()
    await _start_advertising()


async def _start_advertising() -> None:
    """Announce this machine so the peer can find it without an address (§2).

    Never fatal: multicast is blocked in Docker and on some networks, and Mesh
    must keep working by address when it is.
    """
    try:
        from . import secret

        await discovery.advertise(
            port=server.DEFAULT_PORT,
            device_name=(await clock.device_id())[:8],
            chain_id=secret.chain_id(),
        )
    except Exception:
        logger.warning("mesh: advertising unavailable", exc_info=True)


async def _start_listener() -> None:
    """Open the isolated metadata port (§2). Never fatal: a port already in use
    must not stop the app booting, because the app itself does not need Mesh."""
    try:
        from .session import handle_connection

        await server.start(handle_connection)
    except Exception:
        logger.warning("mesh: could not start the listener", exc_info=True)
