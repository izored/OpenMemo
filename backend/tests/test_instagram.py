"""Instagram guest media-info resolver — pure-logic tests (no network).

Covers the parts that break silently: shortcode → media_id decoding, the
carousel/photo/video normalization of an `items[0]` payload, and the fallback
tiers' photo-vs-video verdict (a reel filed as an image is a video nobody ever
downloads — plan 025)."""
import html as html_lib

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

    async def _no_og(url, user_agent=None):
        return {}

    monkeypatch.setattr("backend.core.instagram.fetch_media_info", _no_info)
    monkeypatch.setattr("backend.core.extractor._instagram_gallery_dl", _no_gallery_dl)
    monkeypatch.setattr("backend.core.app_settings.cookies_present", lambda: False)
    # The sniff tier reads its caption from the OG tags. Left unpatched, every
    # test in this file would fetch instagram.com for real.
    monkeypatch.setattr("backend.core.extractor._fetch_og_meta", _no_og)


def _patch_sniff(monkeypatch, result):
    async def _sniff(url, **kw):
        return result

    monkeypatch.setattr("backend.core.sniff_media.sniff_media", _sniff)


def _patch_render(monkeypatch, main_image, slides=(), html=""):
    async def _render(url, **kw):
        return {
            "html": html,
            "screenshot": None,
            "main_image": main_image,
            "slides": list(slides),
        }

    monkeypatch.setattr("backend.core.headless.render_page", _render)


def _patch_og(monkeypatch, title="", description=""):
    async def _og(url, user_agent=None):
        return {"title": title, "description": description}

    monkeypatch.setattr("backend.core.extractor._fetch_og_meta", _og)


# The tags a logged-out render of a live post carried on 2026-09-09, kept in the
# shape Instagram writes them: the caption inside the quotes, the handle before
# " on " in the description. A parser change has to face the real thing rather
# than a tidied-up version of it.
CAPTION = (
    "Never thought I would be a capri girl, but here I am\n"
    "New vision launching 25-5 5pm cest, @dfyne.official\n\n#gymgirls #gymoutfit"
)
LIVE_OG_TITLE = f'Anna Louise Gille on Instagram: "{CAPTION}"'
LIVE_OG_DESC = (
    f'3,416 likes, 79 comments - annalouisegille on August 21, 2026: "{CAPTION}". '
)
# Instagram writes the quotes around the caption as `&quot;` inside the content
# attribute, so the fixture escapes the same way — the parser has to unescape
# before it can find them.
LIVE_OG_HTML = (
    "<html><head>"
    f'<meta property="og:title" content="{html_lib.escape(LIVE_OG_TITLE)}">'
    f'<meta property="og:description" content="{html_lib.escape(LIVE_OG_DESC)}">'
    "</head><body></body></html>"
)


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


class TestCaptionFromOpenGraph:
    """Instagram serves the author and the whole caption in its OG tags even to
    a logged-out visitor. The browser tiers used to hardcode "Instagram post"
    with an empty description and throw all of it away, which is why every save
    that fell past the media-info API arrived with no words at all."""

    def test_reads_caption_and_handle_from_the_live_tags(self):
        from backend.core.extractor import _instagram_text_from_og

        got = _instagram_text_from_og(LIVE_OG_TITLE, LIVE_OG_DESC)
        assert got["caption"] == CAPTION
        assert got["username"] == "annalouisegille"

    def test_reads_the_same_pair_out_of_rendered_html(self):
        from backend.core.extractor import _instagram_text_from_html

        got = _instagram_text_from_html(LIVE_OG_HTML)
        assert got["caption"] == CAPTION
        assert got["username"] == "annalouisegille"

    def test_title_is_the_captions_first_line(self):
        from backend.core.extractor import _instagram_text_from_og, _instagram_titles

        got = _instagram_titles(_instagram_text_from_og(LIVE_OG_TITLE, LIVE_OG_DESC))
        assert got["title"] == "Never thought I would be a capri girl, but here I am"
        assert got["description"] == CAPTION
        assert got["content_text"] == CAPTION

    def test_a_captionless_post_is_filed_under_its_author(self):
        from backend.core.extractor import _instagram_titles

        assert _instagram_titles({"caption": "", "username": "someone"})["title"] == "@someone"

    def test_nothing_readable_keeps_the_old_fallback(self):
        from backend.core.extractor import _instagram_text_from_html, _instagram_titles

        assert _instagram_titles(_instagram_text_from_html(""))["title"] == "Instagram post"
        assert _instagram_titles(_instagram_text_from_html("<html></html>"))["title"] == (
            "Instagram post"
        )


class TestSlideIdentity:
    """A carousel slide is a photo, not a URL. Instagram serves the same photo
    under several size parameters, and the walk used to key on the whole URL —
    so one slide could be counted twice, and (worse) two different slides that
    momentarily shared a rendition read as a wrap-around and ended the walk."""

    async def test_two_renditions_of_one_photo_count_once(self):
        from backend.core.headless import _walk_slides

        page = FakePage([
            "https://cdn/v/a.jpg?stp=small",
            "https://cdn/v/a.jpg?stp=large",
            "https://cdn/v/b.jpg?stp=small",
        ])
        got = await _walk_slides(page, 20)
        assert got == ["https://cdn/v/a.jpg?stp=small", "https://cdn/v/b.jpg?stp=small"]

    async def test_a_slow_transition_is_not_the_end_of_the_carousel(self):
        from backend.core.headless import _walk_slides

        # The stage still shows slide 1 one tick after the click. Stopping there
        # is what made a ten-photo post save as two.
        page = FakePage(["a", "a", "b", "c"])
        assert await _walk_slides(page, 20) == ["a", "b", "c"]

    async def test_seeded_slides_stay_first_and_are_not_repeated(self):
        from backend.core.headless import _walk_slides

        # What the scope enumeration already found, handed to the walk so the
        # two readers cannot disagree about slide one.
        page = FakePage(["https://cdn/v/a.jpg?stp=big", "https://cdn/v/b.jpg"])
        got = await _walk_slides(page, 20, seed=["https://cdn/v/a.jpg?stp=small"])
        assert got == ["https://cdn/v/a.jpg?stp=small", "https://cdn/v/b.jpg"]


class TestBrowserTiersCarryTheWords:
    async def test_render_tier_fills_title_and_description(self, monkeypatch, blocked_api):
        _patch_sniff(monkeypatch, {"media_url": None, "main_image": "https://cdn/a.jpg"})
        _patch_render(monkeypatch, "https://cdn/a.jpg", html=LIVE_OG_HTML)
        r = await _instagram_resolve(PHOTO, "instagram.com")
        assert r["title"] == "Never thought I would be a capri girl, but here I am"
        assert r["description"] == CAPTION
        assert r["content_text"] == CAPTION

    async def test_sniff_tier_fills_title_and_description(self, monkeypatch, blocked_api):
        _patch_sniff(monkeypatch, {
            "media_url": "https://cdn/o1/v/t2/reel.mp4",
            "kind": "progressive",
            "thumbnail_url": "https://cdn/poster.jpg",
        })
        _patch_og(monkeypatch, title=LIVE_OG_TITLE, description=LIVE_OG_DESC)
        r = await _instagram_resolve(REEL, "instagram.com")
        assert r["type"] == "video"
        assert r["title"] == "Never thought I would be a capri girl, but here I am"
        # A video memo shows its caption in the source blurb, not the body.
        assert r["video_description"] == CAPTION

    async def test_render_tier_is_scoped_to_the_post(self, monkeypatch, blocked_api):
        # Without the permalink the render reads the whole page — the post plus
        # the feed around it — and collects no post text at all.
        seen = {}

        async def _render(url, **kw):
            seen.update(kw)
            return {"html": LIVE_OG_HTML, "screenshot": None,
                    "main_image": "https://cdn/a.jpg", "slides": []}

        _patch_sniff(monkeypatch, {"media_url": None, "main_image": None})
        monkeypatch.setattr("backend.core.headless.render_page", _render)
        await _instagram_resolve(PHOTO, "instagram.com")
        assert seen.get("scope_permalink") == PHOTO
