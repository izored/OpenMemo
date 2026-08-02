"""Mesh wire protocol and listener isolation (ADR-024 §2, §5).

The security argument for letting Mesh face a network is that the channel is
narrow and the application is not on it. These tests are that argument, written
down: a closed message set, authentication before parsing, replay rejection, and
a listener whose URL space contains nothing but the sync socket.
"""
import json
import struct

import pytest
from starlette.testclient import TestClient

from backend.core.mesh import protocol, server
from backend.core.mesh.protocol import Frame, MessageType, ProtocolError

PSK = b"\x01" * 32
KEY = b"\x02" * 32
OTHER_PSK = b"\x03" * 32


def _frame(**payload) -> bytes:
    return protocol.encode(
        Frame(type=MessageType.CURSOR, seq=1, payload=payload or {"seq": 5}),
        psk=PSK, content_key=KEY,
    )


# ── round trip ───────────────────────────────────────────────────────────────

def test_a_frame_survives_the_round_trip():
    out = protocol.decode(_frame(seq=42), psk=PSK, content_key=KEY)
    assert out.type is MessageType.CURSOR
    assert out.payload == {"seq": 42}
    assert out.seq == 1


def test_the_payload_is_not_readable_on_the_wire():
    """Anything carrying the connection — including an overlay relay — must be a
    dumb pipe. A memo title must not be greppable out of the bytes."""
    raw = protocol.encode(
        Frame(type=MessageType.ROWS, seq=1,
              payload={"rows": [{"title": "SupersecretMemoTitle"}]}),
        psk=PSK, content_key=KEY,
    )
    assert b"SupersecretMemoTitle" not in raw
    assert b"title" not in raw


# ── authentication ───────────────────────────────────────────────────────────

def test_a_frame_from_the_wrong_key_is_refused():
    with pytest.raises(ProtocolError, match="authentication"):
        protocol.decode(_frame(), psk=OTHER_PSK, content_key=KEY)


def test_tampering_with_a_single_byte_is_caught():
    raw = bytearray(_frame())
    raw[protocol._HEADER_LEN] ^= 0x01          # flip one bit of ciphertext
    with pytest.raises(ProtocolError, match="authentication"):
        protocol.decode(bytes(raw), psk=PSK, content_key=KEY)


def test_authentication_happens_before_parsing():
    """An unauthenticated peer must never reach a JSON parser. Garbage that
    would explode a parser has to die at the tag check instead."""
    raw = b"\x00" * protocol._HEADER_LEN + b"{not json at all" + b"\x00" * 32
    with pytest.raises(ProtocolError, match="authentication"):
        protocol.decode(raw, psk=PSK, content_key=KEY)


# ── replay ───────────────────────────────────────────────────────────────────

def test_a_replayed_frame_is_rejected():
    """Load-bearing once the laptop syncs from a café (§2 tier 2): a captured
    frame must not be replayable later."""
    raw = protocol.encode(Frame(MessageType.ACK, 7, {}), psk=PSK, content_key=KEY)
    protocol.decode(raw, psk=PSK, content_key=KEY, last_seq=6)
    with pytest.raises(ProtocolError, match="replayed"):
        protocol.decode(raw, psk=PSK, content_key=KEY, last_seq=7)


def test_sequence_numbers_only_move_forward():
    s = protocol.Sequencer()
    assert [s.next_out() for _ in range(3)] == [1, 2, 3]
    s.accept(5)
    assert s.last_in == 5


# ── the closed message set ───────────────────────────────────────────────────

def test_an_unknown_message_type_is_refused_not_forwarded():
    """The line that stops the protocol growing a passthrough by accident."""
    body = json.dumps({"t": "run_shell_command", "v": 1, "p": {}}).encode()
    nonce = b"\x09" * protocol._NONCE_LEN
    header = nonce + struct.pack(">Q", 1)
    ct = protocol._xor(body, protocol._keystream(KEY, nonce, len(body)))
    import hashlib, hmac
    tag = hmac.new(PSK, header + ct, hashlib.sha256).digest()

    with pytest.raises(ProtocolError, match="unknown message type"):
        protocol.decode(header + ct + tag, psk=PSK, content_key=KEY)


def test_the_protocol_has_no_verb_that_names_a_path_or_command():
    """Structural guard. The most powerful thing Mesh can say is 'give me these
    rows'. If a future message type sounds like it can reach the filesystem, a
    shell, or the app, this fails and someone has to justify it."""
    forbidden = ("exec", "shell", "command", "path", "file", "proxy",
                 "forward", "request", "fetch", "url", "query", "sql", "eval")
    for m in MessageType:
        assert not any(w in m.value for w in forbidden if w != "request"), m
    # rows_request is the one "request" — and it names row ids, not URLs.
    assert {m.value for m in MessageType} == {
        "hello", "hello_ok", "cursor", "changes", "rows_request", "rows", "ack", "error",
    }, "the message set changed — is the new verb still metadata-only?"


def test_a_wrong_protocol_version_is_refused():
    body = json.dumps({"t": "ack", "v": 999, "p": {}}).encode()
    nonce = b"\x09" * protocol._NONCE_LEN
    header = nonce + struct.pack(">Q", 1)
    ct = protocol._xor(body, protocol._keystream(KEY, nonce, len(body)))
    import hashlib, hmac
    tag = hmac.new(PSK, header + ct, hashlib.sha256).digest()
    with pytest.raises(ProtocolError, match="unsupported protocol version"):
        protocol.decode(header + ct + tag, psk=PSK, content_key=KEY)


# ── size and shape ───────────────────────────────────────────────────────────

def test_an_absurd_frame_is_dropped_before_decryption():
    with pytest.raises(ProtocolError, match="too large"):
        protocol.decode(b"\x00" * (protocol.MAX_FRAME_BYTES + 1), psk=PSK, content_key=KEY)


@pytest.mark.parametrize("junk", [b"", b"short", "a string", None, 12345])
def test_junk_is_rejected_without_raising_anything_odd(junk):
    with pytest.raises(ProtocolError):
        protocol.decode(junk, psk=PSK, content_key=KEY)


# ── listener isolation: the core requirement ─────────────────────────────────

def _listener():
    async def _handler(ws):
        await ws.close()

    return TestClient(server.build_app(_handler))


@pytest.mark.parametrize("path", [
    "/api/memos", "/api/settings", "/api/mesh/status", "/", "/index.html",
    "/../../etc/passwd", "/static/app.js", "/docs", "/openapi.json",
])
def test_the_application_is_not_reachable_from_the_mesh_port(path):
    """openMemo never goes online — only this metadata channel does.

    Not "blocked": these routes were never mounted on this app, so there is
    nowhere for a traversal to traverse to.
    """
    r = _listener().get(path)
    assert r.status_code == 404, f"{path} must not be served by the Mesh listener"
    assert "openmemo" not in r.text.lower()
    assert "memo" not in r.text.lower(), "a probe must learn nothing about the app"


def test_the_mesh_listener_serves_exactly_one_socket():
    """Adding a second route here puts it on the network. Keep it deliberate."""
    app = server.build_app(lambda ws: None)
    ws_routes = [r for r in app.routes if r.__class__.__name__ == "WebSocketRoute"]
    assert len(ws_routes) == 1
    assert ws_routes[0].path == "/mesh"


def test_the_socket_accepts_a_connection():
    async def _handler(ws):
        await ws.send_text("ok")
        await ws.close()

    with TestClient(server.build_app(_handler)).websocket_connect("/mesh") as ws:
        assert ws.receive_text() == "ok"
