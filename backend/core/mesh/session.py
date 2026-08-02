"""A sync conversation (ADR-024 §5).

Transport-agnostic on purpose: a session talks to a `Channel`, not a WebSocket.
That is what lets two sessions be driven against each other in a test without a
network, a port, or a second database — and it means the overlay tier (§2 tier 2)
changes nothing here, because a session cannot tell which tier carried it.

Phase 5 establishes the authenticated conversation: handshake, chain proof,
cursor exchange. Applying rows through the merge engine (§6) and journalling
each decision (§13) lands next, and deliberately not before the dialogue (§7)
exists to handle what merging turns up.
"""
from __future__ import annotations

import logging
from typing import Any, Protocol as TypingProtocol

from backend.core.mesh import changelog, clock, protocol, secret
from backend.core.mesh.protocol import Frame, MessageType, ProtocolError, Sequencer

logger = logging.getLogger(__name__)


class Channel(TypingProtocol):
    """The minimum a transport must provide. A WebSocket satisfies it; so does
    an in-memory pipe, which is how this gets tested."""

    async def send_bytes(self, data: bytes) -> None: ...
    async def receive_bytes(self) -> bytes: ...


class Session:
    """One authenticated conversation with one peer."""

    def __init__(
        self,
        channel: Channel,
        *,
        initiator: bool = False,
        local_device_id: str | None = None,
    ) -> None:
        """`local_device_id` overrides the id read from the database.

        A seam rather than a test hack: two sessions in one process share one
        database and therefore one identity, which the own-id guard below would
        correctly refuse. It is also what phase 8 needs to run a pairing
        rehearsal without a second machine.
        """
        self.channel = channel
        self.initiator = initiator
        self._local_device_id = local_device_id
        self.seq = Sequencer()
        self.peer_device: str | None = None
        self.peer_name: str | None = None
        self._psk = secret.psk()
        self._key = secret.content_key()

    async def send(self, mtype: MessageType, payload: dict[str, Any]) -> None:
        raw = protocol.encode(
            Frame(type=mtype, seq=self.seq.next_out(), payload=payload),
            psk=self._psk, content_key=self._key,
        )
        await self.channel.send_bytes(raw)

    async def recv(self) -> Frame:
        raw = await self.channel.receive_bytes()
        frame = protocol.decode(
            raw, psk=self._psk, content_key=self._key, last_seq=self.seq.last_in
        )
        self.seq.accept(frame.seq)
        return frame

    async def handshake(self) -> None:
        """Prove both sides hold the same Mesh secret, then exchange identity.

        The PSK already authenticated the frame, so reaching here means the peer
        holds the secret. The chain id is checked anyway: it costs nothing and
        turns "wrong library" into a clear error instead of a confusing merge.
        """
        mine = protocol.hello_payload(
            chain_id=secret.chain_id(),
            device_id=self._local_device_id or await clock.device_id(),
            device_name="openMemo",
        )

        if self.initiator:
            await self.send(MessageType.HELLO, mine)
            reply = await self.recv()
            if reply.type is MessageType.ERROR:
                raise ProtocolError(str(reply.payload.get("reason", "rejected")))
            if reply.type is not MessageType.HELLO_OK:
                raise ProtocolError(f"expected hello_ok, got {reply.type.value}")
            theirs = reply.payload
        else:
            hello = await self.recv()
            if hello.type is not MessageType.HELLO:
                raise ProtocolError(f"expected hello, got {hello.type.value}")
            theirs = hello.payload
            if theirs.get("chain_id") != mine["chain_id"]:
                await self.send(MessageType.ERROR, {"reason": "different library"})
                raise ProtocolError("peer belongs to a different library")
            await self.send(MessageType.HELLO_OK, mine)

        if theirs.get("chain_id") != mine["chain_id"]:
            raise ProtocolError("peer belongs to a different library")
        if theirs.get("device_id") == mine["device_id"]:
            # Two machines sharing an identity breaks the ordering tiebreak and
            # misattributes every change. Usually one backup restored onto both.
            raise ProtocolError("peer reports this device's own id")

        self.peer_device = theirs.get("device_id")
        self.peer_name = theirs.get("device_name")
        logger.info("mesh: handshake complete with %s", self.peer_device)

    async def exchange_cursors(self) -> int:
        """Tell the peer how far we have read, and learn how far they have."""
        await self.send(MessageType.CURSOR, {"seq": await changelog.latest_seq()})
        frame = await self.recv()
        if frame.type is not MessageType.CURSOR:
            raise ProtocolError(f"expected cursor, got {frame.type.value}")
        return int(frame.payload.get("seq", 0))


async def handle_connection(websocket) -> None:
    """Adapter from Starlette's WebSocket to a Session. The listener's only job."""

    class _WS:
        async def send_bytes(self, data: bytes) -> None:
            await websocket.send_bytes(data)

        async def receive_bytes(self) -> bytes:
            return await websocket.receive_bytes()

    session = Session(_WS(), initiator=False)
    await session.handshake()
    await session.exchange_cursors()
