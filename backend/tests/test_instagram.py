"""Instagram guest media-info resolver — pure-logic tests (no network).

Covers the parts that break silently: shortcode → media_id decoding, the
carousel/photo/video normalization of an `items[0]` payload, and the fallback
tiers' photo-vs-video verdict (a reel filed as an image is a video nobody ever
downloads — plan 025)."""
import pytest

from backend.core.extractor import _instagram_resolve, _is_video_media_url
from backend.core.instagram import (
    extract_shortcode,
    shortcode_to_media_id,
    _item_to_slide,
    _normalize,
)


class TestShortcode:
    def test_extracts_from_post_with_query(self):
        assert extract_shortcode("https://www.instagram.com/p/DbLbgl6CNpU/?igsh=x") == "DbLbgl6CNpU"

    def test_extracts_reel_and_tv(self):
        assert extract_shortcode("https://instagram.com/reel/ABC-_1/") == "ABC-_1"
        assert extract_shortcode("https://instagram.com/tv/XYZ/") == "XYZ"

    def test_non_instagram_is_none(self):
        assert extract_shortcode("https://example.com/p/x") is None

    def test_media_id_math(self):
        # Verified against Instagram's own encoding for this real shortcode.
        assert shortcode_to_media_id("DbLbgl6CNpU") == 3948370485301533268

    def test_media_id_rejects_bad_chars(self):
        assert shortcode_to_media_id("bad*char") is None


class TestNormalize:
    def test_carousel_builds_ordered_gallery(self):
        item = {
            "carousel_media": [
                {"media_type": 1, "image_versions2": {"candidates": [{"url": "https://cdn/a1.jpg"}, {"url": "https://cdn/a2.jpg"}]}},
                {"media_type": 2, "image_versions2": {"candidates": [{"url": "https://cdn/poster.jpg"}]}, "video_versions": [{"url": "https://cdn/v.mp4"}]},
            ],
            "caption": {"text": "Hello world\nsecond line"},
            "user": {"username": "izo"},
        }
        r = _normalize(item)
        assert r["media_type"] == "carousel"
        assert r["thumbnail"] == "https://cdn/a1.jpg"
        assert [s["type"] for s in r["gallery"]] == ["image", "video"]
        assert r["gallery"][1]["video_url"] == "https://cdn/v.mp4"
        assert r["title"] == "Hello world"

    def test_single_photo(self):
        r = _normalize({"media_type": 1, "image_versions2": {"candidates": [{"url": "https://cdn/p.jpg"}]}, "user": {"username": "a"}})
        assert r["media_type"] == "image" and r["thumbnail"] == "https://cdn/p.jpg"

    def test_single_video(self):
        r = _normalize({"media_type": 2, "image_versions2": {"candidates": [{"url": "https://cdn/po.jpg"}]}, "video_versions": [{"url": "https://cdn/v.mp4"}]})
        assert r["media_type"] == "video" and r["video_url"] == "https://cdn/v.mp4"

    def test_title_falls_back_to_handle(self):
        r = _normalize({"media_type": 1, "image_versions2": {"candidates": [{"url": "https://cdn/p.jpg"}]}, "user": {"username": "handle"}})
        assert r["title"] == "@handle"

    def test_item_without_image_is_none(self):
        assert _item_to_slide({"media_type": 1}) is None

    def test_empty_item_is_none(self):
        assert _normalize({}) is None


REEL = "https://www.instagram.com/reel/DbV_pTDAByT/"
PHOTO = "https://www.instagram.com/p/DbTf7RzDBt9/"


class FakePage:
    """The two calls _walk_slides makes on a page, backed by a script.

    `stage` is what the viewport shows after each click, so a test can hand it
    a wrap-around, a stuck stage, or a missing Next control and assert the walk
    stops for the right reason — without a browser."""

    def __init__(self, stage: list, next_clicks: int | None = None):
        self.stage = stage
        self.i = 0
        # None = a Next control exists forever (the stage list decides the end)
        self.next_clicks = len(stage) - 1 if next_clicks is None else next_clicks
        self.clicks = 0

    async def evaluate(self, js, *args):
        from backend.core.headless import _NEXT_SLIDE_JS, _STAGE_IMAGE_JS

        if js is _STAGE_IMAGE_JS:
            return self.stage[min(self.i, len(self.stage) - 1)]
        if js is _NEXT_SLIDE_JS:
            if self.clicks >= self.next_clicks:
                return False
            self.clicks += 1
            self.i += 1
            return True
        raise AssertionError("unexpected script")

    async def wait_for_timeout(self, _ms):
        return None


class TestWalkSlides:
    async def test_collects_every_slide_in_order(self):
        from backend.core.headless import _walk_slides

        page = FakePage(["a", "b", "c"])
        assert await _walk_slides(page, 20) == ["a", "b", "c"]

    async def test_single_image_page_pages_nowhere(self):
        from backend.core.headless import _walk_slides

        page = FakePage(["only"], next_clicks=0)
        assert await _walk_slides(page, 20) == ["only"]
        assert page.clicks == 0

    async def test_wrap_around_ends_the_walk(self):
        from backend.core.headless import _walk_slides

        # A carousel loops back to slide 1 rather than disabling Next.
        page = FakePage(["a", "b", "a", "b"], next_clicks=3)
        assert await _walk_slides(page, 20) == ["a", "b"]

    async def test_stuck_stage_ends_the_walk(self):
        from backend.core.headless import _walk_slides

        # A Next control that changes nothing (mid-transition, or an unrelated
        # element that happens to be labelled "Next") must not spin.
        page = FakePage(["a", "a", "a"], next_clicks=2)
        assert await _walk_slides(page, 20) == ["a"]

    async def test_respects_the_cap(self):
        from backend.core.headless import _walk_slides

        page = FakePage([str(i) for i in range(30)])
        assert len(await _walk_slides(page, 20)) == 20

    async def test_blank_stage_yields_nothing(self):
        from backend.core.headless import _walk_slides

        assert await _walk_slides(FakePage([None]), 20) == []


@pytest.fixture
def blocked_api(monkeypatch):
    """Every install without a cookie jar lands here: the guest media-info API
    refuses (tiers 1–2) and gallery-dl has no session (tier 3), so the browser
    tiers decide what the memo is. That is the state this bug lived in."""
    async def _no_info(url, **kw):
        return None

    async def _no_gallery_dl(url):
        return None

    monkeypatch.setattr("backend.core.instagram.fetch_media_info", _no_info)
    monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _no_gallery_dl)
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: False)


def _patch_sniff(monkeypatch, result):
    async def _sniff(url, **kw):
        return result

    monkeypatch.setattr("backend.core.sniff_media.sniff_media", _sniff)


def _patch_render(monkeypatch, main_image, slides=()):
    async def _render(url, **kw):
        return {
            "html": "",
            "screenshot": None,
            "main_image": main_image,
            "slides": list(slides),
        }

    monkeypatch.setattr("backend.core.headless.render_page", _render)


class TestVideoMediaUrl:
    def test_video_containers(self):
        assert _is_video_media_url("https://cdn/x.mp4")
        assert _is_video_media_url("https://cdn/x.mov?oe=123")
        assert _is_video_media_url("https://cdn/x.webm#t=1")

    def test_stills_and_garbage(self):
        assert not _is_video_media_url("https://cdn/x.jpg")
        assert not _is_video_media_url("https://cdn/mp4/photo.webp")
        assert not _is_video_media_url("")


class TestResolveBrowserTiers:
    """Tier 4 is the ONLY tier that runs without a cookie jar, so its verdict
    is what every Instagram save depends on."""

    async def test_video_on_the_wire_is_a_video_memo(self, monkeypatch, blocked_api):
        _patch_sniff(monkeypatch, {
            "media_url": "https://cdn/o1/v/t2/reel.mp4",
            "kind": "progressive",
            "thumbnail_url": "https://cdn/poster.jpg",
            "main_image": "https://cdn/suggested.jpg",
        })
        r = await _instagram_resolve(REEL, "instagram.com")
        assert r["type"] == "video"
        # The poster, not the largest random image the page happened to render.
        assert r["thumbnail_path"] == "https://cdn/poster.jpg"

    async def test_no_video_on_the_wire_is_an_image_memo(self, monkeypatch, blocked_api):
        _patch_sniff(monkeypatch, {
            "media_url": None,
            "kind": None,
            "thumbnail_url": "https://cdn/og.jpg",
            "main_image": "https://cdn/ignored.jpg",
        })
        _patch_render(monkeypatch, "https://cdn/photo.jpg")
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["type"] == "image"
        assert r["thumbnail_path"] == "https://cdn/photo.jpg"
        assert not r.get("gallery")

    async def test_paged_carousel_becomes_a_gallery(self, monkeypatch, blocked_api):
        # Without a session the media-info API is the only tier that knows a
        # sidecar has more than one slide, so paging the page is what feeds the
        # gallery viewer at all.
        _patch_sniff(monkeypatch, {"media_url": None, "main_image": "https://cdn/a.jpg"})
        _patch_render(
            monkeypatch, "https://cdn/a.jpg",
            slides=["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"],
        )
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["type"] == "image"
        assert [s["url"] for s in r["gallery"]] == [
            "https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg",
        ]
        # The cover is slide 1, not whatever else the page rendered largest.
        assert r["thumbnail_path"] == "https://cdn/a.jpg"

    async def test_a_reel_is_never_turned_into_a_gallery(self, monkeypatch, blocked_api):
        # If the sniff misses the video, the /reel/ path still says video — and
        # a video memo must not carry a gallery of stray page images.
        _patch_sniff(monkeypatch, None)
        _patch_render(monkeypatch, "https://cdn/a.jpg", slides=["https://cdn/a.jpg", "https://cdn/b.jpg"])
        r = await _instagram_resolve(REEL, "instagram.com")
        assert r["type"] == "video"
        assert not r.get("gallery")

    async def test_sniff_still_covers_a_flaky_render(self, monkeypatch, blocked_api):
        # The sniff pass saw a still; a failed second render must not downgrade
        # the post to the needs-login bookmark.
        _patch_sniff(monkeypatch, {"media_url": None, "main_image": "https://cdn/seen.jpg"})
        _patch_render(monkeypatch, None)
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["type"] == "image"
        assert r["thumbnail_path"] == "https://cdn/seen.jpg"

    async def test_sniff_unavailable_falls_back_to_url_path(self, monkeypatch, blocked_api):
        # No browser sniff (dev venv without patchright): the /reel/ permalink
        # is the last video signal left, and it must still win.
        _patch_sniff(monkeypatch, None)
        _patch_render(monkeypatch, "https://cdn/frame.jpg")
        assert (await _instagram_resolve(REEL, "instagram.com"))["type"] == "video"
        assert (await _instagram_resolve(PHOTO, "instagram.com"))["type"] == "image"

    async def test_all_tiers_dead_is_a_link_not_a_dead_card(self, monkeypatch, blocked_api):
        _patch_sniff(monkeypatch, None)
        _patch_render(monkeypatch, None)
        assert (await _instagram_resolve(REEL, "instagram.com"))["type"] == "link"


class TestResolveGalleryDl:
    async def test_lone_video_entry_is_a_video_memo(self, monkeypatch, blocked_api):
        async def _gdl(url):
            return ["https://cdn/reel.mp4"], "a caption\nrest"

        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _gdl)
        r = await _instagram_resolve(REEL, "instagram.com")
        assert r["type"] == "video"
        # An mp4 must never be parked in the thumbnail slot — cache_thumbnail
        # rejects non-images, which used to leave an expiring URL behind.
        assert r["thumbnail_path"] == ""
        assert r["gallery"] is None

    async def test_mixed_carousel_types_each_slide(self, monkeypatch, blocked_api):
        async def _gdl(url):
            return ["https://cdn/a.jpg", "https://cdn/b.mp4"], "cap"

        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _gdl)
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["type"] == "image"
        assert [s["type"] for s in r["gallery"]] == ["image", "video"]
        assert r["thumbnail_path"] == "https://cdn/a.jpg"

    async def test_video_first_carousel_still_shows_a_still(self, monkeypatch, blocked_api):
        async def _gdl(url):
            return ["https://cdn/a.mp4", "https://cdn/b.jpg"], "cap"

        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _gdl)
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["thumbnail_path"] == "https://cdn/b.jpg"

    async def test_all_video_carousel_is_one_video_not_a_dead_gallery(
        self, monkeypatch, blocked_api
    ):
        # A gallery of mp4s renders nothing and expires in place; a video memo
        # is downloaded and playable.
        async def _gdl(url):
            return ["https://cdn/a.mp4", "https://cdn/b.mp4"], "cap"

        monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _gdl)
        r = await _instagram_resolve(REEL, "instagram.com")
        assert r["type"] == "video"
        assert r["gallery"] is None
        assert r["thumbnail_path"] == ""
