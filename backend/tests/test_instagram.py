"""Instagram guest media-info resolver — pure-logic tests (no network).

Covers the parts that break silently: shortcode → media_id decoding and the
carousel/photo/video normalization of an `items[0]` payload."""
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
