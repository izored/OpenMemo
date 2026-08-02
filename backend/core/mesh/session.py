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
from datetime import datetime
from typing import Any, Protocol as TypingProtocol

from backend.core.mesh import apply as mesh_apply
from backend.core.mesh import changelog, clock, protocol, secret
from backend.core.mesh.protocol import Frame, MessageType, ProtocolError, Sequencer
from backend.db.database import AsyncSessionLocal
from sqlalchemy import text

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
        """Tell the peer how far through THEIR log we have read, and learn how
        far through ours they have.

        The cursor is per peer, not global: "I have seen up to entry 400 of your
        history" is only meaningful about one specific device.
        """
        await self.send(MessageType.CURSOR, {"seq": await self._cursor_for_peer()})
        frame = await self.recv()
        if frame.type is not MessageType.CURSOR:
            raise ProtocolError(f"expected cursor, got {frame.type.value}")
        return int(frame.payload.get("seq", 0))

    async def _cursor_for_peer(self) -> int:
        if not self.peer_device:
            return 0
        async with AsyncSessionLocal() as db:
            row = (await db.execute(
                text("SELECT last_seen_seq FROM mesh_peers WHERE device_id = :d"),
                {"d": self.peer_device},
            )).first()
        return int(row[0]) if row else 0

    async def _remember_cursor(self, seq: int) -> None:
        """Only advance after the rows are applied and journalled. A cursor moved
        early would silently skip changes if the sync died mid-batch."""
        if not self.peer_device or seq <= 0:
            return
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("""
                    INSERT INTO mesh_peers (device_id, name, last_seen_seq, last_sync)
                    VALUES (:d, :n, :s, :t)
                    ON CONFLICT (device_id) DO UPDATE SET
                        name = :n,
                        last_seen_seq = MAX(last_seen_seq, :s),
                        last_sync = :t
                """),
                {"d": self.peer_device, "n": self.peer_name or "",
                 "s": seq, "t": datetime.utcnow().isoformat() + "Z"},
            )
            await db.commit()

    async def send_our_changes(self, since: int) -> int:
        """Ship everything the peer has not seen, as current row state."""
        entries = await changelog.changes_since(since, limit=2000)
        rows = await mesh_apply.export_rows(entries)
        high = max((e["seq"] for e in entries), default=since)
        await self.send(MessageType.CHANGES, {"rows": rows, "high_seq": high})
        return len(rows)

    async def export_preview(self, since: int = 0) -> list[dict[str, Any]]:
        """What we would ship a peer from `since`. Used by the sync-status API
        and by tests that need to see the payload without a second machine."""
        entries = await changelog.changes_since(since, limit=2000)
        return await mesh_apply.export_rows(entries)

    async def receive_their_changes(self) -> mesh_apply.ApplyReport:
        """Apply what the peer sent, then acknowledge how far we got."""
        frame = await self.recv()
        if frame.type is not MessageType.CHANGES:
            raise ProtocolError(f"expected changes, got {frame.type.value}")

        rows = frame.payload.get("rows") or []
        if not isinstance(rows, list):
            raise ProtocolError("changes payload is not a list")

        report = await mesh_apply.apply_rows(
            rows, peer=self.peer_name or self.peer_device or "peer"
        )
        high = int(frame.payload.get("high_seq") or 0)
        await self._remember_cursor(high)
        await self.send(MessageType.ACK, {
            "applied": report.rows_applied,
            "conflicts": report.conflicts,
            "high_seq": high,
        })
        return report

    async def sync(self) -> mesh_apply.ApplyReport:
        """One full exchange. Both sides run the same code; the initiator simply
        speaks first, which is what keeps the conversation from deadlocking."""
        await self.handshake()
        their_cursor = await self.exchange_cursors()

        # Strictly alternating, because both sides read from the same stream:
        # the responder acknowledges BEFORE sending its own changes, so the
        # initiator never finds an ack where it expects data. Getting this wrong
        # deadlocks or desyncs the conversation rather than failing cleanly.
        #
        #   initiator            responder
        #   ---------            ---------
        #   changes  ---------->
        #            <---------- ack
        #            <---------- changes
        #   ack      ---------->
        if self.initiator:
            await self.send_our_changes(their_cursor)
            await self._expect(MessageType.ACK)
            report = await self.receive_their_changes()
        else:
            report = await self.receive_their_changes()
            await self.send_our_changes(their_cursor)
            await self._expect(MessageType.ACK)
        return report

    async def _expect(self, mtype: MessageType) -> Frame:
        frame = await self.recv()
        if frame.type is MessageType.ERROR:
            raise ProtocolError(str(frame.payload.get("reason", "peer reported an error")))
        if frame.type is not mtype:
            raise ProtocolError(f"expected {mtype.value}, got {frame.type.value}")
        return frame


async def handle_connection(websocket) -> None:
    """Adapter from Starlette's WebSocket to a Session. The listener's only job."""

    class _WS:
        async def send_bytes(self, data: bytes) -> None:
            await websocket.send_bytes(data)

        async def receive_bytes(self) -> bytes:
            return await websocket.receive_bytes()

    session = Session(_WS(), initiator=False)
    await session.sync()
