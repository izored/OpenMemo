"""What openMemo keeps a copy of, and what it leaves as a link.

The rule used to be a list of hosts trusted to play their own videos. That is
what left a Facebook memo holding a thumbnail and nothing else: facebook.com
was on the list, the trust was misplaced, and a list cannot notice that.

It is now decided from the size the download is predicted to be, worked out
before anything is fetched. The three payloads below are the shapes three real
links returned on 2026-09-09, so a change to the predictor has to face what
yt-dlp actually hands over rather than a tidy invention.
"""
import pytest

from backend.core.extractor import (
    KEEP_LOCAL_DEFAULT_MB,
    has_embed_player,
    predicted_bytes,
    should_keep_local,
)

MB = 1024 * 1024

# youtube.com/watch — a normal video. No filesize anywhere, bitrate and
# duration present. 19117 kbps for 213s is about half a gigabyte.
YOUTUBE_LONG = {
    "duration": 213,
    "formats": [
        {"vcodec": "avc1", "height": 1080, "tbr": 2500.0},
        {"vcodec": "av01", "height": 2160, "tbr": 19117.677},
        {"vcodec": "none", "acodec": "mp4a", "tbr": 129.0},
    ],
}

# facebook.com/share/r/… — the memo that started this. 1938 kbps for 24s.
FACEBOOK_REEL = {
    "duration": 24.233,
    "formats": [
        {"vcodec": "av01", "height": 1280, "tbr": 900.0},
        {"vcodec": "av01", "height": 1920, "tbr": 1938.514},
    ],
}

# youtube.com/shorts/… — the one host that did report a size.
YOUTUBE_SHORT = {
    "duration": 1,
    "formats": [{"vcodec": "avc1", "height": 480, "tbr": 315.948, "filesize": 36887}],
}


class TestPrediction:
    def test_a_long_video_is_predicted_large(self):
        assert 400 * MB < predicted_bytes(YOUTUBE_LONG) < 600 * MB

    def test_a_reel_is_predicted_small(self):
        assert predicted_bytes(FACEBOOK_REEL) < 10 * MB

    def test_an_exact_filesize_wins_over_the_estimate(self):
        assert predicted_bytes(YOUTUBE_SHORT) == 36887

    def test_it_measures_the_rendition_we_would_actually_take(self):
        # Nothing caps the height any more, so the tallest format is the one
        # that gets downloaded. Predicting from the smallest would wave through
        # every 4K video on the strength of its 360p copy.
        assert predicted_bytes(YOUTUBE_LONG) > predicted_bytes(
            {"duration": 213, "formats": [YOUTUBE_LONG["formats"][0]]}
        )

    def test_audio_only_entries_are_not_mistaken_for_the_video(self):
        audio_only = {"duration": 213, "formats": [YOUTUBE_LONG["formats"][2]]}
        assert predicted_bytes(audio_only) is None

    @pytest.mark.parametrize(
        "payload",
        [{}, {"duration": 0}, {"duration": 60, "formats": []}, {"formats": [{"height": 1}]}],
        ids=["empty", "no-duration", "no-formats", "no-bitrate"],
    )
    def test_nothing_useful_predicts_nothing(self, payload):
        assert predicted_bytes(payload) is None

    def test_junk_input_does_not_raise(self):
        assert predicted_bytes(None) is None
        assert predicted_bytes("not a dict") is None


class TestTheDecision:
    def test_the_facebook_memo_that_started_this_is_kept(self):
        url = "https://www.facebook.com/share/r/1D7PWBAeUB/"
        # The old rule said leave it remote, and that is how it ended up with
        # no file at all.
        assert has_embed_player(url) is True
        assert should_keep_local(url, predicted_bytes(FACEBOOK_REEL)) is True

    def test_a_short_is_kept_even_though_youtube_is_a_link_host(self):
        url = "https://www.youtube.com/shorts/tPEE9ZwTmy0"
        assert has_embed_player(url) is True
        assert should_keep_local(url, predicted_bytes(YOUTUBE_SHORT)) is True

    def test_a_normal_youtube_video_stays_a_link(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert should_keep_local(url, predicted_bytes(YOUTUBE_LONG)) is False

    def test_a_long_video_stays_a_link_on_a_host_with_no_player(self):
        # The point of dropping the host list: length decides, not the domain.
        # A two-hour recording on an unknown host used to download in full.
        two_hours = {"duration": 7200, "formats": [{"vcodec": "avc1", "height": 1080, "tbr": 4000}]}
        assert should_keep_local("https://example.com/talk", predicted_bytes(two_hours)) is False

    def test_the_line_is_where_settings_says(self):
        assert should_keep_local("https://example.com/x", 50 * MB, max_mb=100) is True
        assert should_keep_local("https://example.com/x", 150 * MB, max_mb=100) is False
        # Exactly on the line is kept, so the threshold reads as "up to".
        assert should_keep_local("https://example.com/x", 100 * MB, max_mb=100) is True
        assert KEEP_LOCAL_DEFAULT_MB == 100


class TestTheFallback:
    """No prediction must mean no change from how it behaved before."""

    def test_an_unpredictable_video_follows_the_old_host_rule(self):
        for url in (
            "https://www.youtube.com/watch?v=abc",
            "https://vimeo.com/123",
            "https://www.facebook.com/share/r/xyz/",
        ):
            assert should_keep_local(url, None) is (not has_embed_player(url))

    def test_an_unpredictable_video_on_an_unknown_host_is_still_kept(self):
        assert should_keep_local("https://example.com/clip.mp4", None) is True
