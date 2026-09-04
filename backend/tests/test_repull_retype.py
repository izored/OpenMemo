"""Re-pull repairs a memo that was filed as the wrong TYPE.

Re-pull could already fix a title, a cover and a gallery. It could not fix the
type, so every memo mistyped by an older resolver stayed mistyped no matter how
often it was re-pulled — which made "re-pull one to fix it" false for exactly
the posts that needed it: a Threads photo carousel filed as `video`, a Reddit
text post filed as `video` with a downloader hunting for something to play.

Caught on the live memo this work came from: the re-pull picked up all six
slides and left `type=video`, the stranger's mp4 attached, and Meta's cookie
policy as the body.
"""
from backend.api.ingest import _apply_resolved_type, _is_consent_text


class _Memo:
    """The three fields the repair reads, and the ones it may write."""

    def __init__(self, **kw):
        self.id = "memo-1"
        self.type = "video"
        self.file_path = None
        self.localize_status = None
        self.localize_error = None
        self.content_text = ""
        self.source_url = "https://www.reddit.com/r/pics/comments/1abcdef/a_title/"
        self.__dict__.update(kw)


SIX_SLIDES = [{"url": f"https://cdn/{i}.jpg", "type": "image"} for i in range(6)]
FOUR_SLIDES = [{"url": f"https://cdn/{i}.jpg", "type": "image"} for i in range(4)]
FB_ALBUM = "https://www.facebook.com/share/p/1MKkkWnVcG/"


# ------------------------------------------ a resolve that found nothing


def test_an_empty_resolve_cannot_retype_a_memo_that_has_a_gallery():
    """The live failure, 2026-09-04. A four photo Facebook album, correctly
    filed as images, was re-pulled while Facebook served a consent gate. The
    scope found nothing, `classify_media` answered `video` because that is what
    it says when it has learned nothing on a video host, and the album was filed
    back under Videos, where no gallery branch renders it. The gallery came from
    an earlier read that DID work; one flaky fetch does not outrank it."""
    memo = _Memo(type="image", source_url=FB_ALBUM, gallery=FOUR_SLIDES)
    _apply_resolved_type(memo, {"type": "video"}, [])
    assert memo.type == "image"


def test_a_gallery_stored_as_json_text_counts_too():
    """A raw SQL read hands the column back as text. A guard that only knows
    the list shape is no guard at all on that path."""
    import json

    memo = _Memo(type="image", source_url=FB_ALBUM, gallery=json.dumps(FOUR_SLIDES))
    _apply_resolved_type(memo, {"type": "video"}, [])
    assert memo.type == "image"


def test_an_empty_resolve_still_retypes_a_memo_with_nothing_to_lose():
    """The guard is about protecting evidence, not about refusing to work. A
    memo with no gallery has none to protect, so the old behaviour stands."""
    memo = _Memo(type="link", source_url=FB_ALBUM, gallery=None)
    _apply_resolved_type(memo, {"type": "video"}, [])
    assert memo.type == "video"


def test_a_resolve_that_did_find_media_still_wins():
    """The repair path this whole function exists for has to keep working: a
    resolve holding a carousel outranks whatever the memo said before."""
    memo = _Memo(type="video", source_url=FB_ALBUM, gallery=[{"url": "old.jpg", "type": "image"}])
    _apply_resolved_type(memo, {"type": "image"}, FOUR_SLIDES)
    assert memo.type == "image"


# ------------------------------------------------------------ the repair


def test_a_carousel_filed_as_video_becomes_an_image():
    memo = _Memo(type="video")
    _apply_resolved_type(memo, {"type": "image"}, SIX_SLIDES)
    assert memo.type == "image"


def test_the_strangers_file_is_detached():
    """`derive_memo_type` reads file_path FIRST, so an mp4 left attached to a
    memo the source says is photographs gets re-filed as video by the sorter on
    its next pass, undoing the repair."""
    memo = _Memo(type="video", file_path="files/default/stranger.mp4",
                 localize_status="error", localize_error="No downloadable media")
    _apply_resolved_type(memo, {"type": "image"}, SIX_SLIDES)

    assert memo.type == "image"
    assert memo.file_path is None
    assert memo.localize_status is None
    assert memo.localize_error is None


def test_a_working_video_is_never_demoted_by_a_bare_link_card():
    """The guard that makes this safe. A resolve that fell back to a link card
    has learned nothing about the post and must not take a downloaded video
    away from a memo that plays perfectly well."""
    memo = _Memo(type="video", file_path="files/default/real.mp4")
    _apply_resolved_type(memo, {"type": "link"}, [])

    assert memo.type == "video"
    assert memo.file_path == "files/default/real.mp4"


def test_a_memo_with_no_file_takes_the_resolvers_word():
    """Nothing downloaded, so there is nothing to contradict the resolve. This
    is the Reddit text post filed as video."""
    memo = _Memo(type="video", file_path=None)
    _apply_resolved_type(memo, {"type": "link"}, [])
    assert memo.type == "link"


def test_a_generic_page_scrape_cannot_demote_anything():
    """`extract_url` calls almost every ordinary page a "link". That is not an
    opinion about a post, and acting on it would make re-pull a way to lose a
    video somebody filed deliberately."""
    memo = _Memo(type="video", file_path=None,
                 source_url="https://example.com/watch/1")
    _apply_resolved_type(memo, {"type": "link"}, [])
    assert memo.type == "video"


def test_a_resolver_tier_is_authority_even_off_a_permalink():
    memo = _Memo(type="video", file_path=None,
                 source_url="https://example.com/watch/1")
    _apply_resolved_type(memo, {"type": "link", "resolve_tier": "threads:opengraph"}, [])
    assert memo.type == "link"


def test_a_real_video_post_still_keeps_its_file():
    memo = _Memo(type="image", file_path="files/default/clip.mp4")
    _apply_resolved_type(memo, {"type": "video"}, [])
    assert memo.type == "video"
    assert memo.file_path == "files/default/clip.mp4"


def test_an_unchanged_type_touches_nothing():
    memo = _Memo(type="image", file_path="files/default/a.jpg")
    _apply_resolved_type(memo, {"type": "image"}, SIX_SLIDES)
    assert memo.file_path == "files/default/a.jpg"


def test_a_resolve_with_no_type_touches_nothing():
    memo = _Memo(type="video", file_path="files/default/a.mp4")
    _apply_resolved_type(memo, {}, SIX_SLIDES)
    assert memo.type == "video"
    assert memo.file_path == "files/default/a.mp4"


def test_a_sidecar_of_clips_is_not_carousel_evidence():
    """An all-video gallery is not the unambiguous "this post is pictures"
    signal the file-detaching branch needs."""
    clips = [{"url": f"https://cdn/{i}.mp4", "type": "video"} for i in range(3)]
    memo = _Memo(type="video", file_path="files/default/a.mp4")
    _apply_resolved_type(memo, {"type": "link"}, clips)
    assert memo.type == "video"
    assert memo.file_path == "files/default/a.mp4"


# ------------------------------------------------------- the consent body


def test_a_cookie_screen_body_is_replaceable():
    """The title guard will not touch this: the title beside it is real. Only
    the body is the cookie policy."""
    assert _is_consent_text(
        "Allow the use of cookies from Threads by Instagram on this browser?\n"
        "We use cookies and similar technologies to help provide and improve "
        "content.\nYour cookie choices\nAllow all cookies\nDecline optional cookies"
    )


def test_a_real_article_body_is_not_replaceable():
    assert not _is_consent_text(
        "A long piece about espresso, which mentions cookies once, the edible kind."
    )


def test_an_empty_body_is_not_a_consent_screen():
    assert not _is_consent_text("")


# ------------------------------------ a song is not a video, and an album
# ------------------------------------ is not a download


def test_a_file_with_no_picture_stream_is_not_a_video():
    """The mirror of the silent-reel check. A Facebook photo album can carry a
    song the way a reel does; the sniffer captured the audio representation and
    the download "succeeded" with a 133 second mp4 holding one stream,
    codec_type=audio. `derive_memo_type` reads the extension first, so a five
    photo album was filed under Videos with a song where the video should be."""
    from backend.core.localize_media import _has_audio_stream, _has_video_stream
    import inspect

    a, v = inspect.getsource(_has_audio_stream), inspect.getsource(_has_video_stream)
    assert '"-select_streams", "a"' in a
    assert '"-select_streams", "v"' in v


def test_a_missing_ffprobe_cannot_reject_a_download(monkeypatch, tmp_path):
    """"I cannot tell" must never read as "no pictures", or a box without
    ffprobe would refuse every download it makes. Same rule as its sibling."""
    from backend.config import settings
    from backend.core.localize_media import _has_video_stream

    monkeypatch.setattr(settings, "FFMPEG_BIN", str(tmp_path / "no-such-ffmpeg"))
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"not really a container")
    assert _has_video_stream(f) is None


def test_an_album_is_not_offered_to_the_downloader():
    """Once the memo is `video` the "has media" test says yes, so the next
    re-pull fetches the song again. Three in a row did exactly that live, which
    is how this was found. The gate has to read the gallery, and it has to
    detach a file that holds no pictures or the loop never breaks."""
    import inspect

    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert "album = bool(memo) and len([" in src
    assert "if album and not (resolved or {}).get(\"video_url\"):" in src
    assert "_has_video_stream(on_disk) is False" in src


def test_an_explicit_og_video_still_wins_over_the_album_gate():
    """The source naming a video of its own is not us going looking for one."""
    import inspect

    from backend.api import ingest

    src = inspect.getsource(ingest.repull_memo_task)
    assert "not (resolved or {}).get(\"video_url\")" in src
