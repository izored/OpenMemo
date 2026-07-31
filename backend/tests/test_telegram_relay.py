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
    COLLS = [_C("Faces"), _C("Film Photography"), _C("IG Inbox"), _C("Style refs")]

    def test_exact_ci(self):
        assert _match_collection(self.COLLS, "faces").name == "Faces"

    def test_prefix_beats_substring(self):
        assert _match_collection(self.COLLS, "film").name == "Film Photography"

    def test_substring(self):
        assert _match_collection(self.COLLS, "inbox").name == "IG Inbox"

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
