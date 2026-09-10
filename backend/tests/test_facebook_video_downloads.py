"""A Facebook video is kept, not left to Facebook's player.

A memo saved from `facebook.com/share/r/…` held a thumbnail and nothing to
play. The video was reachable the whole time — yt-dlp inside openMemo's own
container reads that exact link and offers eight formats up to 1920p, measured
2026-09-09. It was never asked, because facebook.com sat on the list of hosts
trusted to play their own videos.

That trust does not survive contact with a share link. Fetching the player
openMemo would have used returns a page with no video element, no playable
address, and a login prompt.

So Facebook comes off the list and its videos download like any host without a
dependable player. Everything else on the list is left exactly as it was: this
is deliberately the smallest change that fixes the case, after a size-aware
rule was tried and parked (docs/parked-2026-09-09-download-policy.md).
"""
import pytest

from backend.core.extractor import has_embed_player


class TestFacebook:
    @pytest.mark.parametrize(
        "url",
        [
            "https://www.facebook.com/share/r/1D7PWBAeUB/",
            "https://www.facebook.com/reel/123456",
            "https://fb.watch/abcdef/",
            "https://fb.com/watch/?v=1",
        ],
    )
    def test_a_facebook_video_is_downloaded(self, url):
        assert has_embed_player(url) is False, (
            "Facebook back on the trusted-player list means memos with nothing to play"
        )


class TestNothingElseMoved:
    """The smallest change means the smallest change."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://vimeo.com/123",
            "https://www.instagram.com/reel/DY8i-dhOUg4/",
            "https://www.tiktok.com/@a/video/1",
            "https://x.com/a/status/1",
            "https://www.dailymotion.com/video/x1",
            "https://www.twitch.tv/videos/1",
        ],
    )
    def test_every_other_host_keeps_its_old_answer(self, url):
        assert has_embed_player(url) is True

    def test_a_host_nobody_listed_still_downloads(self):
        assert has_embed_player("https://example.com/clip.mp4") is False
