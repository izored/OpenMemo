"""Dialing a peer (ADR-024 §2, §5).

The listener existed from phase 5; this is the other half. A device that only
listens can never start a sync, which the convergence harness exposed the moment
it tried to make two real instances talk.

Dialing outward is also what makes the Docker case work at all: a container
cannot be discovered by multicast, but it can always open a connection. Once the
socket is up, the conversation is symmetric — who dialed stops mattering.
"""
from __future__ import annotations

import logging

from backend.core.mesh.session import Session

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 15.0


class _WebSocketChannel:
    """Adapts a `websockets` connection to the Channel protocol a Session wants."""

    def __init__(self, ws) -> None:
        self._ws = ws

    async def send_bytes(self, data: bytes) -> None:
        await self._ws.send(data)

    async def receive_bytes(self) -> bytes:
        message = await self._ws.recv()
        if isinstance(message, str):
            # The protocol is binary only. A text frame is either a bug on the
            # peer or something that is not openMemo.
            raise ValueError("peer sent a text frame; Mesh speaks binary only")
        return message


async def sync_with(host: str, port: int, *, timeout: float = CONNECT_TIMEOUT):
    """Connect to a peer and run one full exchange. Returns the apply report.

    Every failure here is expected in normal use — the other machine is asleep,
    the address is stale, the network moved. Callers treat it as "not now"
    rather than as an error worth interrupting the user for.
    """
    import websockets

    uri = f"ws://{host}:{port}/mesh"
    logger.info("mesh: dialing %s", uri)

    async with websockets.connect(
        uri,
        open_timeout=timeout,
        # The metadata lane is small; a frame far above this is not a sync
        # message and should be refused by the transport, not by us.
        max_size=8 * 1024 * 1024,
    ) as ws:
        session = Session(_WebSocketChannel(ws), initiator=True)
        return await session.sync()
