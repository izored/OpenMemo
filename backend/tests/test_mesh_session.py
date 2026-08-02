"""The sync conversation (ADR-024 §5).

Two sessions are driven against each other through an in-memory pipe, so the
handshake is tested without a port, a network, or a second database. That is the
point of making a session talk to a Channel rather than a WebSocket.
"""
import asyncio

import pytest

from backend.core.mesh import clock, secret
from backend.core.mesh.protocol import MessageType, ProtocolError
from backend.core.mesh.session import Session
from backend.core.mesh.sync_state import mesh_schema_init
from backend.db.database import init_db


class Pipe:
    """One direction of an in-memory channel pair."""

    def __init__(self) -> None:
        self.q: asyncio.Queue[bytes] = asyncio.Queue()


class PipeChannel:
    def __init__(self, outgoing: Pipe, incoming: Pipe) -> None:
        self._out, self._in = outgoing, incoming

    async def send_bytes(self, data: bytes) -> None:
        await self._out.q.put(data)

    async def receive_bytes(self) -> bytes:
        return await asyncio.wait_for(self._in.q.get(), timeout=5)


def linked_pair() -> tuple[PipeChannel, PipeChannel]:
    a_to_b, b_to_a = Pipe(), Pipe()
    return PipeChannel(a_to_b, b_to_a), PipeChannel(b_to_a, a_to_b)


@pytest.fixture(autouse=True)
async def _fresh():
    await init_db()
    await mesh_schema_init()
    yield


async def test_two_devices_complete_a_handshake():
    a_ch, b_ch = linked_pair()
    a = Session(a_ch, initiator=True, local_device_id="aaaaaaaa")
    b = Session(b_ch, initiator=False, local_device_id="bbbbbbbb")

    await asyncio.gather(a.handshake(), b.handshake())

    assert a.peer_device == "bbbbbbbb"
    assert b.peer_device == "aaaaaaaa"


async def test_cursors_are_exchanged_after_the_handshake():
    a_ch, b_ch = linked_pair()
    a = Session(a_ch, initiator=True, local_device_id="aaaaaaaa")
    b = Session(b_ch, initiator=False, local_device_id="bbbbbbbb")
    await asyncio.gather(a.handshake(), b.handshake())

    seqs = await asyncio.gather(a.exchange_cursors(), b.exchange_cursors())
    assert all(isinstance(s, int) for s in seqs)


async def test_a_peer_holding_a_different_secret_cannot_connect():
    """The PSK authenticates every frame, so a wrong secret fails at the tag
    check — before any payload is parsed."""
    a_ch, b_ch = linked_pair()
    a = Session(a_ch, initiator=True)
    b = Session(b_ch, initiator=False)
    b._psk = b"\xff" * 32          # a peer from a different library

    with pytest.raises((ProtocolError, asyncio.TimeoutError)):
        await asyncio.wait_for(asyncio.gather(a.handshake(), b.handshake()), timeout=5)


async def test_a_device_refuses_to_sync_with_its_own_identity():
    """Two machines sharing an id breaks the ordering tiebreak and misattributes
    every change — usually one backup restored onto both. Fail loudly rather
    than merge a library with itself."""
    a_ch, b_ch = linked_pair()
    a = Session(a_ch, initiator=True, local_device_id="samedev1")
    b = Session(b_ch, initiator=False, local_device_id="samedev1")

    results = await asyncio.gather(
        a.handshake(), b.handshake(), return_exceptions=True
    )
    assert any(
        isinstance(r, ProtocolError) and "own id" in str(r) for r in results
    ), f"expected an own-id refusal, got {results}"


async def test_the_secret_derives_distinct_keys():
    """One key used three ways is how protocols grow cross-protocol attacks."""
    assert secret.psk() != secret.content_key()
    assert secret.chain_id() != secret.psk().hex()
    assert secret.psk() == secret.psk(), "derivation must be stable"
