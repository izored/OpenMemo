"""Verified session for the lossless music relay.

The relay stopped accepting a shared API key in August 2026 and now answers
every download with `428 Verification session required`. A session is issued
only after a challenge a person completes in a browser, which is the point of
the challenge — so these tests pin the parts openMemo is responsible for: the
signature it produces, the secret never leaving the machine, and a missing
session failing with a sentence instead of an HTTP code.
"""
import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.core import music_relay


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_session():
    from backend.core.app_settings import set_music_relay

    set_music_relay({})
    yield
    set_music_relay({})


def _verified(days: int = 30) -> dict:
    from backend.core.app_settings import set_music_relay

    record = {
        "install_id": "0123456789abcdef0123456789abcdef",
        "session_id": "sess-abc",
        "session_secret": "shhh-secret",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(),
    }
    set_music_relay(record)
    return record


def test_no_session_fails_with_something_a_person_can_act_on(client):
    with pytest.raises(music_relay.RelayNotVerified) as e:
        music_relay.sign("POST", "https://qbz-oss.spotbye.qzz.io/api/dl", b"{}")
    assert "Settings" in str(e.value)


def test_an_expired_session_is_not_used(client):
    _verified(days=-1)
    assert music_relay.session_valid() is False
    assert music_relay.status()["expired"] is True
    assert music_relay.status()["was_verified"] is True


def test_the_signature_matches_the_scheme_the_relay_verifies(client):
    """Rebuild it the way the server does. If this drifts, every download 401s
    and the reason is invisible from the outside."""
    record = _verified()
    body = b'{"id":"123","quality":"24"}'
    headers = music_relay.sign("POST", "https://qbz-oss.spotbye.qzz.io/api/dl", body)

    assert headers["X-Sig-Body-SHA256"] == hashlib.sha256(body).hexdigest()
    assert headers["X-Sig-Session"] == record["session_id"]
    assert headers["X-Sig-Platform"] == "desktop"

    stamp = datetime.strptime(headers["X-Sig-Timestamp"], "%Y-%m-%dT%H:%M:%S.%fZ")
    window = int(stamp.replace(tzinfo=timezone.utc).timestamp()) // 300
    rolling = hmac.new(
        record["session_secret"].encode(),
        f"{window}:{record['session_id']}".encode(),
        hashlib.sha256,
    ).digest()
    expected = base64.urlsafe_b64encode(hmac.new(rolling, "\n".join([
        "SPOTIFLAC-HMAC-V1", "POST", "/api/dl", "",
        headers["X-Sig-Body-SHA256"], headers["X-Sig-Timestamp"],
        headers["X-Sig-Nonce"], record["session_id"],
        music_relay.app_version(), "desktop",
    ]).encode(), hashlib.sha256).digest()).rstrip(b"=").decode()

    assert headers["X-Sig-Signature"] == expected


def test_each_request_gets_its_own_nonce(client):
    _verified()
    a = music_relay.sign("POST", "https://x/api/dl", b"{}")
    b = music_relay.sign("POST", "https://x/api/dl", b"{}")
    assert a["X-Sig-Nonce"] != b["X-Sig-Nonce"]


def test_the_secret_never_crosses_the_api(client):
    _verified()
    assert "music_relay" not in client.get("/api/settings").json()
    body = client.get("/api/settings/music-relay/status").json()
    assert body["verified"] is True
    assert "session_secret" not in str(body)


def test_disconnect_forgets_the_session_but_keeps_the_install(client):
    record = _verified()
    body = client.delete("/api/settings/music-relay/session").json()
    assert body["verified"] is False
    assert music_relay.install_id() == record["install_id"]


def test_a_callback_that_was_never_started_is_rejected(client):
    """The state is what ties a returning browser to a verification openMemo
    actually began. Without that check anyone could post a grant at it."""
    resp = client.get("/api/settings/music-relay/verify/callback?state=made-up&grant=x")
    assert resp.status_code == 400
    assert "expired" in resp.text.lower()


def test_verification_start_refuses_a_nonsense_callback_base(client):
    resp = client.post(
        "/api/settings/music-relay/verify/start",
        json={"callback_base": "not-a-url"},
    )
    assert resp.status_code == 502


def test_the_callback_lives_where_the_relay_insists(client):
    """The relay only issues a challenge for a callback at exactly
    `/session-grant`. Anything under `/api/` comes back as a 400 with an empty
    page — verified against the live service on 2026-08-05, and the reason
    clicking Verify showed a blank card."""
    from backend.core import music_relay

    assert music_relay.CALLBACK_PATH == "/session-grant"

    # And openMemo answers there, not only under /api/.
    resp = client.get("/session-grant?state=nope&grant=x")
    assert resp.status_code == 400
    assert "expired" in resp.text.lower()


def test_the_challenge_link_points_the_relay_back_at_that_path(client, monkeypatch):
    import httpx

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return {"challenge_url": "https://verify.example.com/challenge?id=abc"}

    monkeypatch.setattr(httpx, "get", lambda *a, **k: _Resp())
    out = music_relay.start_verification("http://localhost:8091")

    assert "cb=http%3A%2F%2Flocalhost%3A8091%2Fsession-grant" in out["challenge_url"]
    assert "%2Fapi%2F" not in out["challenge_url"]
