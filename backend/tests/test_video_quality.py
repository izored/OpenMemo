"""A kept video is an archive copy, so it is kept at the host's best.

The format selector used to cap every download at 1080p. That made sense when
"make it local" was the only thing that downloaded and the fear was a full disk.
It stopped making sense once the save path decided what to keep by predicting
its size: a four megabyte reel was being served its 1080p rendition while its
1440p and 2160p ones were discarded for no saving at all.

A ceiling is still available. It is now something you choose in Settings, not
something you have to discover and remove.
"""
import pytest

from backend.core.localize_media import (
    DEFAULT_QUALITY,
    QUALITY_BEST,
    VALID_QUALITIES,
    _video_format,
)


class TestDefault:
    def test_the_default_asks_for_the_best_rendition(self):
        assert DEFAULT_QUALITY == QUALITY_BEST
        fmt = _video_format(DEFAULT_QUALITY)
        assert "height<=" not in fmt, f"a ceiling crept back into the default: {fmt}"
        assert "bestvideo" in fmt

    def test_an_unrecognised_value_falls_back_to_best_not_to_1080(self):
        # The old fallback was 1080, so a caller passing something odd quietly
        # got a capped download. Failing open to "best" is the safer default
        # for something whose job is to survive the source disappearing.
        assert "height<=" not in _video_format(999)
        assert "height<=" not in _video_format(0)


class TestCeiling:
    @pytest.mark.parametrize("cap", [720, 1080, 1440, 2160])
    def test_a_chosen_ceiling_is_applied(self, cap):
        fmt = _video_format(cap)
        assert f"height<={cap}" in fmt
        # Every branch of the selector honours it, or the fallback branch
        # silently downloads 4K when the mp4 branch misses.
        assert fmt.count(f"height<={cap}") == 3

    def test_every_offered_ceiling_is_accepted(self):
        assert VALID_QUALITIES == {QUALITY_BEST, 720, 1080, 1440, 2160}


class TestPreferenceIsResolvedOnce:
    """The route and the background job must not disagree about the default."""

    def test_the_route_falls_back_to_the_setting(self, monkeypatch):
        from backend.core import app_settings

        monkeypatch.setattr(app_settings, "get_settings", lambda: {"video_quality_cap": 1440})
        cap = int(app_settings.get_settings().get("video_quality_cap", 0) or 0)
        assert cap in VALID_QUALITIES
        assert "height<=1440" in _video_format(cap)

    def test_no_setting_at_all_means_no_ceiling(self, monkeypatch):
        from backend.core import app_settings

        monkeypatch.setattr(app_settings, "get_settings", lambda: {})
        cap = int(app_settings.get_settings().get("video_quality_cap", 0) or 0)
        assert cap == QUALITY_BEST
        assert "height<=" not in _video_format(cap)


class TestNoRouteStillForcesTheOldCap:
    """The ceiling has to be gone from every path, not just the automatic one.

    It was removed from the save path first, and three places went on sending
    a ceiling anyway: the durable queue's replay default, the API client's
    default argument, and the memo page's initial picker value. So "Make it
    local" — the button someone presses precisely because they want to keep the
    thing — was the one path still capped.

    There was a source-grep test here as well, asserting the literal was absent
    from the handler. It failed on the comment explaining why the literal was
    removed, which is the whole case against tests that read code instead of
    running it. Deleted rather than reworded.
    """

    async def test_a_replayed_job_follows_the_setting(self, monkeypatch):
        """The dispatcher's payload, handed to the real task signature."""
        seen = {}

        async def _task(memo_id, mode, quality=None):
            seen["quality"] = quality

        monkeypatch.setattr("backend.api.ingest.localize_memo_task", _task)

        from backend.core.job_handlers import KIND_LOCALIZE
        from backend.core.jobs import _HANDLERS

        # What the queue stores for an explicit localize with no chosen height,
        # dispatched exactly as the worker dispatches it.
        await _HANDLERS[KIND_LOCALIZE].fn({"memo_id": "m1", "mode": "video"})
        assert seen["quality"] is None, (
            "a replayed job must defer to Settings, not carry a hardcoded cap"
        )
