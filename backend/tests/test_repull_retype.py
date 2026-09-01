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
