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

Frames are `nonce | seq | ciphertext+tag`, sealed with **AES-256-GCM**. The
header is passed as associated data, so the sequence number is authenticated
without being encrypted — a replayed or renumbered frame fails the tag rather
than merely failing a comparison afterwards.

Phase 5 shipped a hand-rolled SHA256 counter-mode keystream with a separate
HMAC, to avoid a crypto dependency before anything faced a network. Phase 9
replaces it, because "the authenticator is real so tampering is caught" is a
fine argument on a LAN and a bad one once the laptop syncs from a café. AES-GCM
gives confidentiality and integrity in one reviewed primitive, and removes the
chance of a mistake in code I wrote myself.
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
_GCM_TAG_LEN = 16
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


def _gcm_nonce(header_nonce: bytes) -> bytes:
    """Derive GCM's 12-byte nonce from the 16 random bytes on the wire."""
    return hashlib.sha256(header_nonce).digest()[:12]


def _aead(content_key: bytes):
    """AES-256-GCM over the content key.

    GCM's tag covers both the ciphertext and the associated data, so binding the
    header (nonce + sequence) as AAD means a renumbered frame fails
    authentication outright rather than being caught by a later check that
    someone could forget to perform.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    return AESGCM(content_key[:32])


def encode(frame: Frame, *, psk: bytes, content_key: bytes) -> bytes:
    """Serialize, encrypt, then authenticate. Order matters: the tag covers the
    ciphertext, so tampering is caught without ever decrypting attacker input."""
    body = json.dumps(
        {"t": frame.type.value, "v": PROTOCOL_VERSION, "p": frame.payload},
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")

    nonce = os.urandom(_NONCE_LEN)
    header = nonce + struct.pack(">Q", frame.seq)
    # GCM wants a 12-byte nonce; the 16-byte header nonce is hashed down so the
    # wire format is unchanged and the value stays unique per frame.
    sealed = _aead(content_key).encrypt(_gcm_nonce(nonce), body, header)
    # The PSK tag stays on top of GCM: it proves the peer holds the pairing
    # secret before we spend a single AES operation on attacker-chosen bytes.
    tag = hmac.new(psk, header + sealed, hashlib.sha256).digest()
    return header + sealed + tag


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
        plain = _aead(content_key).decrypt(_gcm_nonce(nonce), ciphertext, header)
    except Exception:
        # InvalidTag and friends. Deliberately not echoed: the reason a frame
        # failed to decrypt is information an attacker would like.
        raise ProtocolError("frame failed authenticated decryption") from None
    try:
        body = json.loads(plain)
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
