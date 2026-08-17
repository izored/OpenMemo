"""Telegram capture relay (ADR-020) — pure-logic tests.

Covers the pieces that can break silently: Instagram URL canonicalization
(share-sheet tracking params must not mint twin memos), URL extraction from a
message, callback_data round-trip sizing, and the owner-lock gate settings."""
from backend.core.extractor import (
    canonical_source_url,
    _is_instagram_video_path,
    _parse_gallery_dl_dump,
)
from backend.services.telegram_relay import _URL_RE, _match_collection


class TestCanonicalSourceUrl:
    def test_strips_instagram_tracking_query(self):
        assert (
            canonical_source_url("https://www.instagram.com/p/DKKxnIZOX1f/?igsh=abc123")
            == "https://www.instagram.com/p/DKKxnIZOX1f/"
        )

    def test_strips_instagram_fragment(self):
        assert (
            canonical_source_url("https://instagram.com/p/XYZ/#frag")
            == "https://instagram.com/p/XYZ/"
        )

    def test_leaves_youtube_query_alone(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert canonical_source_url(url) == url

    def test_leaves_plain_urls_alone(self):
        url = "https://example.com/article"
        assert canonical_source_url(url) == url

    def test_never_raises_on_garbage(self):
        assert canonical_source_url("not a url at all") == "not a url at all"


class TestMessageUrlExtraction:
    def test_finds_url_in_plain_share(self):
        m = _URL_RE.search("https://www.instagram.com/p/DKKxnIZOX1f/?igsh=1")
        assert m and m.group(0).startswith("https://www.instagram.com/p/")

    def test_finds_url_amid_text(self):
        m = _URL_RE.search("look at this https://example.com/x cool right")
        assert m and m.group(0) == "https://example.com/x"

    def test_no_url_returns_none(self):
        assert _URL_RE.search("hello bot") is None

    def test_trailing_punctuation_strippable(self):
        # Mirrors the rstrip in _handle_message: prose punctuation after the
        # URL must not reach the pipeline.
        m = _URL_RE.search("look: https://www.instagram.com/p/ABC/, wow")
        assert m is not None
        assert m.group(0).rstrip(".,;:!?)]}’”") == "https://www.instagram.com/p/ABC/"


class TestInstagramVideoPath:
    """Reels must never be misfiled as photos: Instagram's crawler pages do
    NOT reliably carry og:video (verified live 2026-07-24), so the URL path
    itself is the guard."""

    def test_reel_is_video(self):
        assert _is_instagram_video_path("https://www.instagram.com/reel/DYfBJL4ER4w/")

    def test_reels_and_tv_are_video(self):
        assert _is_instagram_video_path("https://instagram.com/reels/XYZ/")
        assert _is_instagram_video_path("https://instagram.com/tv/XYZ/")

    def test_photo_post_is_not(self):
        assert not _is_instagram_video_path("https://www.instagram.com/p/DKKxnIZOX1f/")

    def test_garbage_never_raises(self):
        assert not _is_instagram_video_path("::not a url::")


class TestGalleryDlDump:
    def test_collects_all_type3_urls_and_first_caption(self):
        # A carousel yields one type-3 entry per slide — the parser must return
        # ALL of them (ordered), not just the first, so the whole gallery lands.
        dump = (
            '[[2, {"category": "instagram"}],'
            ' [3, "https://cdn.example/full.jpg", {"description": "the caption"}],'
            ' [3, "https://cdn.example/second.jpg", {"description": "the caption"}]]'
        )
        assert _parse_gallery_dl_dump(dump) == (
            ["https://cdn.example/full.jpg", "https://cdn.example/second.jpg"],
            "the caption",
        )

    def test_single_image_returns_one(self):
        dump = '[[3, "https://cdn.example/only.jpg", {"description": "cap"}]]'
        assert _parse_gallery_dl_dump(dump) == (["https://cdn.example/only.jpg"], "cap")

    def test_garbage_returns_none(self):
        assert _parse_gallery_dl_dump("not json") is None
        assert _parse_gallery_dl_dump("[[2, {}]]") is None


class _C:
    def __init__(self, name):
        self.name = name


class TestCollectionMatch:
    COLLS = [_C("Faces"), _C("Film Photography"), _C("Bot Inbox"), _C("Style refs")]

    def test_exact_ci(self):
        assert _match_collection(self.COLLS, "faces").name == "Faces"

    def test_prefix_beats_substring(self):
        assert _match_collection(self.COLLS, "film").name == "Film Photography"

    def test_substring(self):
        assert _match_collection(self.COLLS, "inbox").name == "Bot Inbox"

    def test_no_match(self):
        assert _match_collection(self.COLLS, "zzz") is None

    def test_empty_query(self):
        assert _match_collection(self.COLLS, "  ") is None


class TestCallbackDataSize:
    def test_move_callback_fits_telegram_64_byte_cap(self):
        # Two 8-char id prefixes + separators — the format _collection_buttons
        # emits and _handle_callback parses.
        data = f"mv:{'a' * 8}:{'b' * 8}"
        assert len(data.encode()) <= 64
        parts = data.split(":")
        assert len(parts) == 3 and parts[0] == "mv"


class TestOwnerLockSettings:
    def test_lock_roundtrip(self, tmp_path, monkeypatch):
        import backend.core.app_settings as aps

        monkeypatch.setattr(aps, "_PATH", tmp_path / "app_settings.json")
        aps.set_telegram_allowed_user(12345)
        assert aps.get_telegram_allowed_user() == 12345
        assert aps.telegram_user_locked() is True
        aps.set_telegram_allowed_user(0)
        assert aps.get_telegram_allowed_user() == 0
        assert aps.telegram_user_locked() is False

    def test_clearing_token_clears_lock(self, tmp_path, monkeypatch):
        import backend.core.app_settings as aps

        monkeypatch.setattr(aps, "_PATH", tmp_path / "app_settings.json")
        aps.set_telegram_token("123:abcdefghijklmnopqrstuvwxyz1234567890")
        aps.set_telegram_allowed_user(777)
        assert aps.telegram_token_present() and aps.telegram_user_locked()
        aps.set_telegram_token("")
        assert not aps.telegram_token_present()
        assert not aps.telegram_user_locked()


class TestOnlyOnePollerPerHost:
    """Telegram hands each message to exactly ONE caller of getUpdates.

    So a second backend polling the same token does not duplicate the user's
    captures — it takes them, at random, into whatever database that process is
    using. A dev backend started from dev-db.ps1 did precisely that between
    2026-08-09 and 2026-08-11: the bot kept answering "Saved OK" while roughly
    half the memos landed in dev-data and never showed up in the app.
    """

    def test_env_kill_switch_stops_the_relay(self, monkeypatch):
        from backend.services import telegram_relay as tr

        monkeypatch.setenv("OPENMEMO_DISABLE_TELEGRAM", "1")
        reason = tr.relay_disabled_reason()
        assert reason and "OPENMEMO_DISABLE_TELEGRAM" in reason

    def test_kill_switch_accepts_the_usual_truthy_spellings(self, monkeypatch):
        from backend.services import telegram_relay as tr

        for value in ("1", "true", "TRUE", "yes", "on"):
            monkeypatch.setenv("OPENMEMO_DISABLE_TELEGRAM", value)
            assert tr.relay_disabled_reason(), f"{value!r} should disable the relay"

    def test_an_empty_or_false_value_does_not_disable_it(self, monkeypatch):
        from backend.core import host_lock
        from backend.services import telegram_relay as tr

        host_lock.release("telegram-relay")
        for value in ("", "0", "false", "no"):
            monkeypatch.setenv("OPENMEMO_DISABLE_TELEGRAM", value)
            assert tr.relay_disabled_reason() is None, f"{value!r} should not disable it"
        host_lock.release("telegram-relay")

    async def test_the_relay_loop_returns_instead_of_polling(self, monkeypatch):
        """A blocked relay must exit the loop, not spin. It also has to say why
        in RELAY_STATUS, so Settings shows a reason rather than a dead widget."""
        from backend.services import telegram_relay as tr

        monkeypatch.setenv("OPENMEMO_DISABLE_TELEGRAM", "1")

        async def boom(*a, **kw):
            raise AssertionError("a disabled relay must never call Telegram")

        # Both, not just the wrapper: _drain calls _tg_strict, so patching
        # only _tg left this tripwire aimed at a function the poll path no
        # longer uses, and a regressed kill switch would hang the forever
        # loop here instead of failing the assertion.
        monkeypatch.setattr(tr, "_tg", boom)
        monkeypatch.setattr(tr, "_tg_strict", boom)

        await tr.run_relay_loop()

        assert tr.RELAY_STATUS["running"] is False
        assert "not started" in (tr.RELAY_STATUS["last_error"] or "")


class TestHostLock:
    def test_a_second_claim_from_another_handle_is_refused(self, monkeypatch, tmp_path):
        """Two processes, one machine, different data directories — the case the
        Mesh singleton election cannot see."""
        import tempfile

        from backend.core import host_lock

        monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
        host_lock.release("probe")

        assert host_lock.claim("probe") is True

        # Simulate the other process: a fresh handle on the same lock file.
        handle = open(host_lock._lock_path("probe"), "a+")
        try:
            assert host_lock._try_lock(handle) is False
        finally:
            handle.close()
            host_lock.release("probe")

    def test_claiming_twice_in_one_process_is_fine(self, monkeypatch, tmp_path):
        import tempfile

        from backend.core import host_lock

        monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
        host_lock.release("probe2")
        assert host_lock.claim("probe2") is True
        assert host_lock.claim("probe2") is True
        host_lock.release("probe2")


class TestUnreachableIsNotSilence:
    """A relay that cannot reach Telegram must say so.

    `_tg` used to swallow every exception and return None, which `_drain` read
    as "no new messages". The loop then cleared `last_error` and stamped
    `last_poll_at`, so the Settings card said "Polling. Last check 14:32"
    through an entire flight with no wifi while every call was failing.
    """

    async def test_transport_failure_raises_rather_than_returning_none(self):
        import httpx

        from backend.services import telegram_relay as tr

        class DeadClient:
            async def post(self, *a, **kw):
                raise httpx.ConnectError("nodename nor servname provided")

        try:
            await tr._tg_strict(DeadClient(), "tok", "getUpdates")
        except tr.TelegramUnreachable as e:
            assert "ConnectError" in str(e)
        else:
            raise AssertionError("a dead connection must raise, not return None")

    async def test_api_level_rejection_raises_with_the_reason(self):
        from backend.services import telegram_relay as tr

        class RejectingClient:
            async def post(self, *a, **kw):
                class R:
                    @staticmethod
                    def json():
                        return {"ok": False, "description": "Unauthorized"}

                return R()

        try:
            await tr._tg_strict(RejectingClient(), "revoked", "getUpdates")
        except tr.TelegramUnreachable as e:
            assert "Unauthorized" in str(e)
        else:
            raise AssertionError("a revoked token must surface, not look quiet")

    async def test_an_empty_update_list_is_success_not_failure(self):
        """The trap in the split: getUpdates answering `[]` means "reached
        Telegram, nothing new". Treating falsy as broken would flip a healthy
        quiet relay into a permanent error state."""
        from backend.services import telegram_relay as tr

        class QuietClient:
            async def post(self, *a, **kw):
                class R:
                    @staticmethod
                    def json():
                        return {"ok": True, "result": []}

                return R()

        assert await tr._tg_strict(QuietClient(), "tok", "getUpdates") == []

    async def test_chatty_calls_still_swallow(self):
        """Losing a receipt is not losing a capture, so `_tg` keeps returning
        None for the cosmetic calls."""
        import httpx

        from backend.services import telegram_relay as tr

        class DeadClient:
            async def post(self, *a, **kw):
                raise httpx.ConnectError("down")

        assert await tr._tg(DeadClient(), "tok", "sendMessage") is None


class TestKick:
    """macOS stops the monotonic clock during system sleep, so the backend's
    15 minute timer comes out of an eight hour nap with 15 minutes still to
    run. Wake, unlock and reconnect all cut that short."""

    async def test_a_kick_ends_the_wait_early(self):
        import asyncio
        import time

        from backend.services import telegram_relay as tr

        async def kick_soon():
            await asyncio.sleep(0.02)
            tr.kick()

        started = time.monotonic()
        await asyncio.gather(tr._sleep_or_kick(30), kick_soon())
        assert time.monotonic() - started < 5, "the kick did not interrupt the sleep"

    async def test_the_event_is_cleared_so_the_next_wait_still_waits(self):
        import asyncio

        from backend.services import telegram_relay as tr

        waiter = asyncio.create_task(tr._sleep_or_kick(30))
        await asyncio.sleep(0)               # let it bind the event and park
        tr.kick()
        await waiter
        try:
            await asyncio.wait_for(tr._sleep_or_kick(30), timeout=0.05)
        except asyncio.TimeoutError:
            pass                             # correct: it is waiting again
        else:
            raise AssertionError("a stale kick leaked into the next interval")

    async def test_a_kick_with_nothing_waiting_does_not_arm_the_next_wait(self):
        """kick() must not create the event.

        It used to call the same helper the waiter used, so a kick arriving from
        another loop replaced the very Event the relay was parked on. That kick
        was lost, and so was every later one for the rest of the interval.
        """
        import asyncio

        from backend.services import telegram_relay as tr

        tr._KICK = None
        tr._KICK_LOOP = None
        tr.kick()
        assert tr._KICK is None, "kick() must not bind an event nobody is awaiting"
        try:
            await asyncio.wait_for(tr._sleep_or_kick(30), timeout=0.05)
        except asyncio.TimeoutError:
            pass
        else:
            raise AssertionError("a kick with no waiter pre-armed the next interval")

    def test_a_kick_outside_a_loop_is_a_no_op(self):
        from backend.services import telegram_relay as tr

        tr.kick()   # must not raise



class TestStaleness:
    """Telegram drops an undelivered share at 24 hours, so "how long since it
    answered" is the number every warning hangs on. Each of these was a real way
    to get that number wrong."""

    def _reset(self, monkeypatch, tmp_path):
        import backend.core.app_settings as aps
        from backend.services import telegram_relay as tr

        monkeypatch.setattr(aps, "_PATH", tmp_path / "app_settings.json")
        tr.RELAY_STATUS["last_success_at"] = None
        tr.RELAY_STATUS["running_since"] = None
        tr._last_persisted_iso = None
        return tr

    def test_a_timezone_aware_stamp_does_not_raise(self, monkeypatch, tmp_path):
        """fromisoformat parses an offset or a trailing Z happily, and the
        subtraction against a naive utcnow() then raises TypeError. That escaped
        the guard, reached the relay's generic handler, and wedged the loop in a
        60 second retry that never called Telegram again."""
        tr = self._reset(monkeypatch, tmp_path)
        for stamp in ("2026-08-17T09:41:02Z", "2026-08-17T09:41:02+00:00"):
            tr.RELAY_STATUS["last_success_at"] = stamp
            hours = tr.hours_since_success()
            assert hours is not None and hours >= 0, stamp

    def test_garbage_is_none_not_an_exception(self, monkeypatch, tmp_path):
        tr = self._reset(monkeypatch, tmp_path)
        tr.RELAY_STATUS["last_success_at"] = "not a timestamp"
        assert tr.hours_since_success() is None

    def test_never_answered_is_stale_once_the_relay_has_had_a_chance(self, monkeypatch, tmp_path):
        """A token that was wrong from the first minute never writes a stamp, so
        the gap reads as None. Treating None as healthy left the worst-off user
        with no warning anywhere while Telegram dropped everything they sent."""
        from datetime import datetime, timedelta

        tr = self._reset(monkeypatch, tmp_path)
        assert tr.hours_since_success() is None

        tr.RELAY_STATUS["running_since"] = datetime.utcnow().isoformat()
        assert tr.is_stale() is False, "a relay that just started is not stale yet"

        tr.RELAY_STATUS["running_since"] = (
            datetime.utcnow() - timedelta(hours=tr._NEVER_ANSWERED_GRACE_HOURS + 1)
        ).isoformat()
        assert tr.is_stale() is True, "hours up with no answer at all is the clearest stale there is"

    def test_the_persist_throttle_uses_the_wall_clock(self, monkeypatch, tmp_path):
        """It used to compare time.monotonic(), which stops during macOS sleep.
        A laptop draining once a day gathered about a minute of monotonic time
        between drains, never reached ten, and never persisted, so the disk
        stamp sat days behind a healthy relay and the next launch shouted."""
        from datetime import datetime, timedelta

        import backend.core.app_settings as aps

        tr = self._reset(monkeypatch, tmp_path)
        tr._note_success()
        first = aps.get_telegram_last_success()
        assert first, "the first success must persist immediately"

        tr._note_success()
        assert aps.get_telegram_last_success() == first, "throttled inside the window"

        # Eleven minutes of WALL time later, with no monotonic time passing at
        # all, which is how a sleeping Mac experiences it.
        tr._last_persisted_iso = (datetime.utcnow() - timedelta(minutes=11)).isoformat()
        tr._note_success()
        assert aps.get_telegram_last_success() != first, "past the window it must persist"

    def test_a_failed_write_is_retried_rather_than_blackholed(self, monkeypatch, tmp_path):
        """The marker used to advance before the write was known to have landed,
        so one transient PermissionError skipped the stamp for ten minutes."""
        from backend.services import telegram_relay as tr_mod

        tr = self._reset(monkeypatch, tmp_path)
        calls = []

        def boom(stamp):
            calls.append(stamp)
            raise PermissionError("held by another process")

        monkeypatch.setattr(tr_mod, "set_telegram_last_success", boom)
        tr._note_success()
        tr._note_success()
        assert len(calls) == 2, "a failed persist must be retried on the next success"


class TestNonDictResponse:
    async def test_a_bare_null_body_does_not_escape_as_an_attribute_error(self):
        """A proxy or captive portal can answer null or [] under a JSON content
        type. Calling .get on that raised AttributeError straight through _tg,
        which is documented never to raise, and killed the cycle over a
        cosmetic sendMessage."""
        from backend.services import telegram_relay as tr

        class OddClient:
            def __init__(self, payload):
                self.payload = payload

            async def post(self, *a, **kw):
                payload = self.payload

                class R:
                    @staticmethod
                    def json():
                        return payload

                return R()

        for payload in (None, [], "nope"):
            assert await tr._tg(OddClient(payload), "tok", "sendMessage") is None, payload
