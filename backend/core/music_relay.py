"""Verified session for the lossless music relay (Apple Music + Spotify).

The community relay that SpotiFLAC's download chain ends at used to accept a
shared API key. As of 2026-08 it answers every download request with:

    HTTP 428  {"success": false, "error": "Verification session required."}

It now wants a session, and a session is only issued after a **challenge that a
person completes in a browser**. That is deliberate on their side, and it is not
something to work around: this module implements the same flow the upstream
desktop app does, with the human where the design puts them.

    Settings → Verify → openMemo asks the relay for a challenge URL
                     → you open it and complete the challenge yourself
                     → the relay sends your browser back to openMemo with a grant
                     → openMemo trades the grant for a session and stores it

After that every relay request is signed with the session secret
(`SPOTIFLAC-HMAC-V1`, a rolling key on a five-minute window). The secret never
leaves this machine and is never returned over openMemo's own API.

Sessions expire. When one does, downloads fail with a message that says to
verify again rather than a bare HTTP code — 188 tracks in one library were
sitting behind exactly that error with nothing explaining it.

Endpoint and protocol values are re-derived from spotbye/SpotiFLAC (MIT):
`backend/community_endpoints.go` for the URLs (AES-256-GCM, key = SHA-256 over
the seed parts, AAD alongside) and `backend/community_session.go` for the
bootstrap/exchange/signing scheme. They rotate; see docs/make-it-local.md.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

import httpx

from backend.config import settings

log = logging.getLogger("openmemo.music")

VERIFY_BASE = "https://verify.spotbye.qzz.io"

# Where the relay is willing to send the browser back to. Verified against the
# live service on 2026-08-05: every other path answers 400 before rendering.
CALLBACK_PATH = "/session-grant"
PLATFORM = "desktop"

# The challenge link is single-use and short-lived on their side; this is only
# how long openMemo keeps expecting a particular callback to come back.
_PENDING_TTL_S = 15 * 60

# Treat a session as expired slightly early, so a download does not start with
# a signature that goes stale mid-flight.
_EXPIRY_SKEW = timedelta(minutes=5)

# state -> {"install_id": str, "created": float}. In memory on purpose: an
# interrupted verification should be restarted, not resumed after a restart.
_pending: dict[str, dict] = {}


class RelayNotVerified(Exception):
    """No usable session. The message is written to be shown to the user."""


def app_version() -> str:
    """The version string the relay expects to see in a signature.

    NOT openMemo's version. The relay normalises an app version it does not
    recognise to "unknown" when it mints the challenge — visible in the
    challenge token — and then validates signatures against the value IT
    stored. Sending our own version means signing a string the server never
    reconstructs, which comes back as:

        HTTP 401  {"success": false, "error": "Signed request validation failed."}

    Verified against the live relay on 2026-08-06: the same request signed with
    "openMemo/3.8.0" is refused and signed with "unknown" is accepted. Upstream
    uses the identical fallback for a build with no version set, so this is
    declining to claim a version rather than impersonating one.
    """
    return "unknown"


def _record() -> dict:
    from backend.core.app_settings import get_music_relay

    return get_music_relay() or {}


def _store(record: dict) -> None:
    from backend.core.app_settings import set_music_relay

    set_music_relay(record)


def install_id() -> str:
    """A stable per-install identifier, generated once.

    Not an account and not tied to anything of the user's — the relay uses it to
    bind a challenge to the client that asked for it."""
    record = _record()
    if not record.get("install_id"):
        record["install_id"] = secrets.token_hex(16)
        _store(record)
    return record["install_id"]


def _expires_at(record: dict) -> datetime | None:
    raw = (record.get("expires_at") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def session_valid(record: dict | None = None) -> bool:
    record = record if record is not None else _record()
    if not record.get("session_id") or not record.get("session_secret"):
        return False
    expires = _expires_at(record)
    return expires is not None and expires - _EXPIRY_SKEW > datetime.now(timezone.utc)


def status() -> dict:
    """What Settings shows. Never includes the secret."""
    record = _record()
    expires = _expires_at(record)
    return {
        "verified": session_valid(record),
        "expires_at": record.get("expires_at") or None,
        # Distinguishes "never set this up" from "it lapsed", which need
        # different sentences in the UI.
        "was_verified": bool(record.get("session_id")),
        "expired": bool(record.get("session_id")) and not session_valid(record),
        "expires_in_days": (
            max(0, (expires - datetime.now(timezone.utc)).days) if expires else None
        ),
    }


def start_verification(callback_base: str) -> dict:
    """Ask the relay for a challenge URL for the user to open.

    `callback_base` is openMemo's own origin as the BROWSER sees it, because the
    browser is what gets redirected back. Behind nginx or in Docker that is not
    the same as what the server sees locally, which is why the caller supplies
    it rather than this guessing."""
    parsed = urlparse(callback_base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise RelayNotVerified("openMemo could not work out its own address for the callback.")

    state = secrets.token_urlsafe(24)
    _prune_pending()
    _pending[state] = {"install_id": install_id(), "created": time.time()}

    query = urlencode({
        "install_id": install_id(),
        "app_version": app_version(),
        "platform": PLATFORM,
    })
    try:
        resp = httpx.get(f"{VERIFY_BASE}/bootstrap?{query}", timeout=20)
    except httpx.HTTPError as e:
        raise RelayNotVerified(f"Could not reach the music relay: {e}") from e
    if resp.status_code != 200:
        raise RelayNotVerified(f"The music relay refused to start a verification (HTTP {resp.status_code}).")

    challenge_url = (resp.json() or {}).get("challenge_url") or ""
    if not challenge_url.startswith("https://"):
        raise RelayNotVerified("The music relay returned an invalid challenge link.")

    # The path is NOT ours to choose. The relay only issues a challenge for a
    # callback at exactly /session-grant: anything under /api/ comes back as a
    # 400 with an empty page, which is what "I clicked Verify and nothing
    # appeared" looked like. Host and port are free; the path is fixed.
    callback = f"{callback_base.rstrip('/')}{CALLBACK_PATH}?state={state}"
    joiner = "&" if "?" in challenge_url else "?"
    return {
        "challenge_url": f"{challenge_url}{joiner}{urlencode({'cb': callback})}",
        "state": state,
    }


def _prune_pending() -> None:
    cutoff = time.time() - _PENDING_TTL_S
    for state in [s for s, v in _pending.items() if v["created"] < cutoff]:
        _pending.pop(state, None)


def complete_verification(state: str, grant: str) -> dict:
    """Trade the grant the browser came back with for a stored session."""
    _prune_pending()
    entry = _pending.pop(state, None)
    if entry is None:
        raise RelayNotVerified("That verification link has expired. Start again from Settings.")
    if not grant.strip():
        raise RelayNotVerified("The relay sent openMemo back without a grant.")

    try:
        resp = httpx.post(
            f"{VERIFY_BASE}/session/exchange",
            json={
                "grant": grant,
                "install_id": entry["install_id"],
                "app_version": app_version(),
                "platform": PLATFORM,
            },
            timeout=20,
        )
    except httpx.HTTPError as e:
        raise RelayNotVerified(f"Could not reach the music relay: {e}") from e
    if resp.status_code != 200:
        raise RelayNotVerified(f"The relay would not issue a session (HTTP {resp.status_code}).")

    body = resp.json() or {}
    if not (body.get("session_id") and body.get("session_secret") and body.get("expires_at")):
        raise RelayNotVerified("The relay's answer was incomplete.")

    _store({
        "install_id": entry["install_id"],
        "session_id": body["session_id"],
        "session_secret": body["session_secret"],
        "expires_at": body["expires_at"],
        "verified_at": datetime.now(timezone.utc).isoformat(),
    })
    log.info("music relay: session stored, expires %s", body["expires_at"])
    return status()


def disconnect() -> dict:
    """Forget the session, keeping the install id so a re-verify is the same client."""
    record = _record()
    _store({"install_id": record.get("install_id") or secrets.token_hex(16)})
    return status()


def _hmac(key: bytes, message: bytes) -> bytes:
    return hmac.new(key, message, hashlib.sha256).digest()


def sign(method: str, url: str, body: bytes) -> dict[str, str]:
    """Signature headers for one relay request (`SPOTIFLAC-HMAC-V1`).

    The signing key is not the session secret directly: it is an HMAC of the
    secret over `<five-minute window>:<session id>`, so a captured signature
    stops being useful within minutes. The signed string covers the method,
    path, body hash, timestamp, nonce, session, app version and platform, which
    is why every one of those also travels as a header — the server rebuilds the
    same string from them.
    """
    record = _record()
    if not session_valid(record):
        raise RelayNotVerified(
            "Lossless music downloads need a verified session. "
            "Settings → Files → Music relay → Verify."
        )

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    nonce = secrets.token_hex(12)
    body_hash = hashlib.sha256(body).hexdigest()
    window = int(now.timestamp()) // 300

    rolling = _hmac(record["session_secret"].encode(), f"{window}:{record['session_id']}".encode())
    signing_input = "\n".join([
        "SPOTIFLAC-HMAC-V1",
        method.upper(),
        urlparse(url).path,
        "",
        body_hash,
        timestamp,
        nonce,
        record["session_id"],
        app_version(),
        PLATFORM,
    ])
    signature = base64.urlsafe_b64encode(_hmac(rolling, signing_input.encode())).rstrip(b"=")

    return {
        "X-Sig-Session": record["session_id"],
        "X-Sig-Timestamp": timestamp,
        "X-Sig-Nonce": nonce,
        "X-Sig-Body-SHA256": body_hash,
        "X-Sig-Signature": signature.decode(),
        "X-Sig-App-Version": app_version(),
        "X-Sig-Platform": PLATFORM,
    }
