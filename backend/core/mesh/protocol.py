"""Mesh wire protocol (ADR-024 §2 isolation, §5 transport).

The whole security argument for putting Mesh on the network rests on this file
being narrow. openMemo itself never goes online; what crosses is a metadata
channel with a **closed** set of message types and no way to become anything
else.

Three rules, and they are why the blast radius of Mesh being reachable is the
sync protocol rather than the application:

1. **Authenticate before parsing.** `decode()` checks the HMAC before it
   deserializes anything. An unauthenticated peer never reaches a JSON parser,
   let alone a database.
2. **No passthrough verb.** `MessageType` is an enum, and an unknown type is
   rejected rather than forwarded. There is deliberately no "run this", no
   "proxy that", no generic query. Adding one would defeat the design.
3. **Replay protection built in, not bolted on.** Every frame carries a
   monotonic sequence; a frame at or below the last seen number is dropped.
   On a LAN that was defence in depth. Once the MacBook syncs from a café
   (§2 tier 2) it is load-bearing, so it exists from the start rather than being
   retrofitted under pressure.

Frames are `nonce | seq | ciphertext | tag`. The payload is encrypted so that
anything carrying the connection — including an overlay relay — is a dumb pipe
that cannot read the library.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import struct
from dataclasses import dataclass
from enum import Enum
from typing import Any

PROTOCOL_VERSION = 1

# A frame the size of a memory allocator's worst day is not a legitimate sync
# message. Bound it before decrypting, not after.
MAX_FRAME_BYTES = 8 * 1024 * 1024

_NONCE_LEN = 16
_TAG_LEN = 32
_SEQ_LEN = 8
_HEADER_LEN = _NONCE_LEN + _SEQ_LEN


class MessageType(str, Enum):
    """Every message Mesh can carry. A closed set, on purpose.

    Nothing here can name a file path, a shell command, a URL to fetch or an
    application route. The most powerful verb is "give me these rows".
    """

    HELLO = "hello"                # version + chain proof + device id
    HELLO_OK = "hello_ok"
    CURSOR = "cursor"              # "I have seen up to seq N"
    CHANGES = "changes"            # change-log entries
    ROWS_REQUEST = "rows_request"  # "send the current state of these row ids"
    ROWS = "rows"                  # the rows themselves
    ACK = "ack"
    ERROR = "error"


class ProtocolError(Exception):
    """Anything malformed, unauthenticated, replayed or unknown."""


@dataclass
class Frame:
    type: MessageType
    seq: int
    payload: dict[str, Any]


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """SHA256 counter-mode keystream.

    Deliberately hand-rolled from hashlib rather than adding a crypto
    dependency for phase 5: it keeps the transport testable now, and phase 9
    (which is where this actually faces a hostile network) swaps in AES-GCM
    from `cryptography` behind this same seam. The authenticator is a real
    HMAC either way, so a tampered frame is rejected regardless.
    """
    out = b""
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(key + nonce + struct.pack(">I", counter)).digest()
        counter += 1
    return out[:length]


def _xor(data: bytes, pad: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(data, pad))


def encode(frame: Frame, *, psk: bytes, content_key: bytes) -> bytes:
    """Serialize, encrypt, then authenticate. Order matters: the tag covers the
    ciphertext, so tampering is caught without ever decrypting attacker input."""
    body = json.dumps(
        {"t": frame.type.value, "v": PROTOCOL_VERSION, "p": frame.payload},
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")

    nonce = os.urandom(_NONCE_LEN)
    seq_bytes = struct.pack(">Q", frame.seq)
    ciphertext = _xor(body, _keystream(content_key, nonce, len(body)))
    header = nonce + seq_bytes
    tag = hmac.new(psk, header + ciphertext, hashlib.sha256).digest()
    return header + ciphertext + tag


def decode(raw: bytes, *, psk: bytes, content_key: bytes, last_seq: int = -1) -> Frame:
    """Authenticate, check for replay, then parse. Never the other order.

    `last_seq` is the highest sequence already accepted on this connection.
    Passing -1 disables the check, which only tests should ever do.
    """
    if not isinstance(raw, (bytes, bytearray)):
        raise ProtocolError("frame must be bytes")
    if len(raw) > MAX_FRAME_BYTES:
        raise ProtocolError("frame too large")
    if len(raw) < _HEADER_LEN + _TAG_LEN:
        raise ProtocolError("frame too short")

    header, ciphertext, tag = (
        raw[:_HEADER_LEN],
        raw[_HEADER_LEN:-_TAG_LEN],
        raw[-_TAG_LEN:],
    )

    expected = hmac.new(psk, header + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, tag):
        # compare_digest, not ==: a timing-variable comparison on an
        # authenticator is a real attack, and this one faces the network.
        raise ProtocolError("bad authentication tag")

    seq = struct.unpack(">Q", header[_NONCE_LEN:])[0]
    if last_seq >= 0 and seq <= last_seq:
        raise ProtocolError(f"replayed or out-of-order frame (seq {seq} <= {last_seq})")

    nonce = header[:_NONCE_LEN]
    try:
        body = json.loads(_xor(ciphertext, _keystream(content_key, nonce, len(ciphertext))))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProtocolError(f"unreadable payload: {exc}") from None

    if not isinstance(body, dict):
        raise ProtocolError("payload is not an object")
    if body.get("v") != PROTOCOL_VERSION:
        raise ProtocolError(f"unsupported protocol version {body.get('v')!r}")

    try:
        mtype = MessageType(body.get("t"))
    except ValueError:
        # An unknown verb is refused, never forwarded. This is the line that
        # keeps the protocol from growing a passthrough by accident.
        raise ProtocolError(f"unknown message type {body.get('t')!r}") from None

    payload = body.get("p")
    if not isinstance(payload, dict):
        raise ProtocolError("payload body is not an object")

    return Frame(type=mtype, seq=seq, payload=payload)


class Sequencer:
    """Per-connection frame numbering. Outbound counts up, inbound must too."""

    def __init__(self) -> None:
        self._out = 0
        self._in = -1

    def next_out(self) -> int:
        self._out += 1
        return self._out

    @property
    def last_in(self) -> int:
        return self._in

    def accept(self, seq: int) -> None:
        self._in = seq


def hello_payload(*, chain_id: str, device_id: str, device_name: str) -> dict[str, Any]:
    """What a peer learns before it is trusted: which library, and who is
    calling. The chain id is already a hash of the secret (§2), so it proves
    membership without revealing anything that could be replayed elsewhere."""
    return {
        "chain_id": chain_id,
        "device_id": device_id,
        "device_name": device_name,
        "protocol": PROTOCOL_VERSION,
    }
