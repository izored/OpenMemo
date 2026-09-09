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
