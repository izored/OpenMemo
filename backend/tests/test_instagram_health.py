"""Instagram health + canary — the safeguards against a SILENT downgrade.

The bug these exist for (plan 025) never raised anything: the resolver kept
returning memos, just poorer ones, for six weeks. So the thing worth testing is
the judgement call — when do we speak up, and when would that be noise?
"""
import pytest
from fastapi.testclient import TestClient

from backend.core.extractor import (
    IG_FALLBACK_TIERS,
    IG_TIER_API_ANON,
    IG_TIER_API_COOKIE,
    IG_TIER_BLOCKED,
    IG_TIER_BROWSER_RENDER,
    IG_TIER_BROWSER_SNIFF,
    IG_TIERS,
)
from backend.main import app


class TestTierConstants:
    def test_every_tier_is_ordered_best_to_worst(self):
        assert IG_TIERS.index(IG_TIER_API_COOKIE) < IG_TIERS.index(IG_TIER_BROWSER_RENDER)
        assert IG_TIERS[-1] == IG_TIER_BLOCKED

    def test_api_tiers_are_never_treated_as_a_fallback(self):
        # The whole point: an API tier read the real post. If either of these
        # ever counted as degraded, the warning would fire constantly.
        assert IG_TIER_API_ANON not in IG_FALLBACK_TIERS
        assert IG_TIER_API_COOKIE not in IG_FALLBACK_TIERS

    def test_browser_tiers_are_the_ones_worth_warning_about(self):
        assert IG_TIER_BROWSER_SNIFF in IG_FALLBACK_TIERS
        assert IG_TIER_BROWSER_RENDER in IG_FALLBACK_TIERS
        assert IG_TIER_BLOCKED in IG_FALLBACK_TIERS


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class TestHealthEndpoint:
    def test_an_empty_library_reports_ok_not_a_problem(self, client):
        # A library with nothing tagged yet (every install, the day this ships)
        # must not be accused of being broken.
        r = client.get("/api/settings/instagram/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["checked"] == 0

    def test_reports_the_shape_the_ui_needs(self, client):
        body = client.get("/api/settings/instagram/health").json()
        for key in ("status", "connected", "checked", "degraded", "blocked", "recent_tiers"):
            assert key in body


class TestCanaryVerdict:
    """The canary compares a re-resolve against what is stored."""

    async def test_degraded_tier_beats_a_matching_media_type(self, monkeypatch):
        # Even when the media still looks right, landing on a browser tier is
        # the signal — that IS the downgrade, before anything looks wrong.
        from backend.core import canary

        class FakeMemo:
            id = "m1"
            source_url = "https://www.instagram.com/p/X/"
            type = "image"
            gallery = [{"url": "a"}, {"url": "b"}]
            file_path = None

        async def _sample(limit=2):
            return [FakeMemo()]

        async def _resolve(url, domain):
            return {
                "type": "image",
                "gallery": [{"url": "a"}, {"url": "b"}],
                "resolve_tier": IG_TIER_BROWSER_RENDER,
            }

        monkeypatch.setattr(canary, "_sample_memos", _sample)
        monkeypatch.setattr("backend.core.extractor._instagram_resolve", _resolve)
        result = await canary.run_instagram_canary()
        assert result["status"] == "degraded"

    async def test_fewer_slides_than_stored_is_a_mismatch(self, monkeypatch):
        from backend.core import canary

        class FakeMemo:
            id = "m1"
            source_url = "https://www.instagram.com/p/X/"
            type = "image"
            gallery = [{"url": "a"}, {"url": "b"}, {"url": "c"}]
            file_path = None

        async def _sample(limit=2):
            return [FakeMemo()]

        async def _resolve(url, domain):
            return {"type": "image", "gallery": [{"url": "a"}], "resolve_tier": IG_TIER_API_COOKIE}

        monkeypatch.setattr(canary, "_sample_memos", _sample)
        monkeypatch.setattr("backend.core.extractor._instagram_resolve", _resolve)
        result = await canary.run_instagram_canary()
        assert result["status"] == "mismatch"

    async def test_healthy_when_the_api_still_answers_with_the_same_media(self, monkeypatch):
        from backend.core import canary

        class FakeMemo:
            id = "m1"
            source_url = "https://www.instagram.com/p/X/"
            type = "video"
            gallery = None
            file_path = "/files/x.mp4"

        async def _sample(limit=2):
            return [FakeMemo()]

        async def _resolve(url, domain):
            return {"type": "video", "resolve_tier": IG_TIER_API_COOKIE}

        monkeypatch.setattr(canary, "_sample_memos", _sample)
        monkeypatch.setattr("backend.core.extractor._instagram_resolve", _resolve)
        result = await canary.run_instagram_canary()
        assert result["status"] == "ok"

    async def test_a_library_with_no_instagram_is_skipped_not_failed(self, monkeypatch):
        from backend.core import canary

        async def _sample(limit=2):
            return []

        monkeypatch.setattr(canary, "_sample_memos", _sample)
        result = await canary.run_instagram_canary()
        assert result["status"] == "skipped"

    async def test_a_resolver_crash_never_escapes(self, monkeypatch):
        from backend.core import canary

        class FakeMemo:
            id = "m1"
            source_url = "https://www.instagram.com/p/X/"
            type = "image"
            gallery = None
            file_path = "/files/x.jpg"

        async def _sample(limit=2):
            return [FakeMemo()]

        async def _resolve(url, domain):
            raise RuntimeError("instagram exploded")

        monkeypatch.setattr(canary, "_sample_memos", _sample)
        monkeypatch.setattr("backend.core.extractor._instagram_resolve", _resolve)
        result = await canary.run_instagram_canary()
        assert result["status"] == "skipped"
        assert result["checks"][0]["outcome"] == "error"


class TestTheWarningMeansSomethingWentWrong:
    """Reading a post without a login is not a fault.

    The check used to count every browser-tier save as degraded. That was
    correct while those tiers produced a poorer memo — a reel as a still, a
    carousel as one photo. It stopped being correct the day they learned to
    read the caption and walk the whole carousel, and the warning went on
    firing at a library whose memos were all fine. Measured on a live install
    2026-09-09: twelve of twelve reported degraded, and every one of those
    twelve had its caption, its slides and a local cover.
    """

    def _health(self, client):
        return client.get("/api/settings/instagram/health").json()

    def _rows(self, monkeypatch, tiers):
        """Pretend the last few saves used these tiers."""
        import backend.api.settings as settings_api

        class _Result:
            def scalars(self):
                return self

            def all(self):
                return tiers

        class _Session:
            async def execute(self, *a, **kw):
                return _Result()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        monkeypatch.setattr(settings_api, "AsyncSessionLocal", _Session, raising=False)
        monkeypatch.setattr(
            "backend.db.database.AsyncSessionLocal", _Session, raising=False
        )

    def test_saves_without_a_login_do_not_raise_a_warning(self, client, monkeypatch):
        self._rows(monkeypatch, ["instagram:browser-render"] * 12)
        monkeypatch.setattr("backend.core.canary.last_result", lambda: None)
        body = self._health(client)
        assert body["status"] == "ok"
        # The fact is still reported, just not as a fault.
        assert body["no_session_saves"] == 12
        assert body["degraded"] == 0

    def test_a_save_that_actually_failed_does(self, client, monkeypatch):
        self._rows(monkeypatch, ["instagram:blocked"] * 12)
        monkeypatch.setattr("backend.core.canary.last_result", lambda: None)
        body = self._health(client)
        assert body["status"] in ("no_session", "session_expired")
        assert body["degraded"] == 12

    def test_a_reader_that_stopped_working_says_so_in_its_own_words(
        self, client, monkeypatch
    ):
        from backend.core import extractor

        self._rows(monkeypatch, ["instagram:api-cookie"] * 12)
        monkeypatch.setattr("backend.core.canary.last_result", lambda: None)
        extractor._IG_CAPTION_READS.clear()
        extractor._IG_CAPTION_READS.extend([True] * 8)
        try:
            body = self._health(client)
            # Not a session problem. Connecting an account would not help.
            assert body["status"] == "unreadable"
            assert body["captions"]["broken"] is True
        finally:
            extractor._IG_CAPTION_READS.clear()

    def test_a_stale_canary_verdict_of_degraded_no_longer_alarms(
        self, client, monkeypatch
    ):
        # The stored verdict has no expiry, so a week-old "read without a
        # login" was keeping the banner up on a healthy library.
        self._rows(monkeypatch, ["instagram:browser-render"] * 12)
        monkeypatch.setattr(
            "backend.core.canary.last_result", lambda: {"status": "degraded"}
        )
        assert self._health(client)["status"] == "ok"

    def test_a_canary_mismatch_still_alarms(self, client, monkeypatch):
        # Slides going missing is the original bug and must still be loud.
        self._rows(monkeypatch, ["instagram:api-cookie"] * 12)
        monkeypatch.setattr(
            "backend.core.canary.last_result", lambda: {"status": "mismatch"}
        )
        assert self._health(client)["status"] != "ok"
