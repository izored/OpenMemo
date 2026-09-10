"""A Facebook photo album must never be pulled as a video. Fifth report.

Three independent failures stacked up on one live album
(`facebook.com/share/1VAZoyFq8Z/`, measured 2026-09-10), and each one on its own
was enough to produce the wrong memo:

1. The share wrapper Facebook hands out has no type letter. `_SHAPES` knew
   `/share/p|v|r|g/<code>` and not the bare `/share/<code>`, so `post_scope`
   answered None, `resolve_permalink` returned at its guard, the 302 to
   `/groups/OctaneRender/posts/3525920920918294` was never followed, and no
   scope was ever attempted.
2. Even from the true permalink, the scope cannot work: a logged-out browser is
   served a login wall. 13 anchors, 511 characters of text, zero `/posts/`
   anchors, unchanged over a 12-second poll.
3. `og:type` for that album, served to a link-preview crawler with no wall, is
   `video.other`.

With nothing known, `classify_media` falls back to `video` because the domain is
a video host. That fallback is correct and must stay; what was missing is
evidence. The payload inside the walled page names the post's four photos.
"""
import pytest

from backend.core.facebook import MEDIA_URL, album_photos, post_id
from backend.core.permalinks import is_share_wrapper, post_scope, resolve_permalink
from backend.core.social import classify_media, slides

ALBUM = "https://www.facebook.com/groups/OctaneRender/posts/3525920920918294"
WRAPPER = "https://www.facebook.com/share/1VAZoyFq8Z/"
POST_ID = "3525920920918294"


# ------------------------------------------------------- the share wrapper


@pytest.mark.parametrize(
    "url",
    [
        WRAPPER,                                              # the bare form
        "https://www.facebook.com/share/p/1MKkkWnVcG/",       # the typed forms
        "https://www.facebook.com/share/v/1MKkkWnVcG/",
        "https://www.facebook.com/share/r/1D7PWBAeUB/",
        "https://www.facebook.com/share/g/1MKkkWnVcG/",
    ],
)
def test_every_facebook_share_spelling_is_followed(url):
    """The gate that decides whether to follow a redirect. Before this, only
    the typed spellings passed and the bare one silently skipped resolution."""
    assert is_share_wrapper(url), "a share wrapper must be worth a HEAD"
    assert post_scope(url) is not None


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/blog/hello-world",
        "https://x.com/jack/status/20",
        "https://www.instagram.com/p/DAbc123xyz/",
    ],
)
def test_an_ordinary_url_is_not_treated_as_a_wrapper(url):
    """Following a redirect costs a HEAD request on every save. Only wrapper-
    shaped URLs pay it."""
    assert not is_share_wrapper(url)


@pytest.mark.asyncio
async def test_the_wrapper_resolves_to_the_post_it_names(monkeypatch):
    """Runs the real `resolve_permalink` against a stubbed redirect, so the
    guard, the HEAD and the destination check all execute."""
    landed = ALBUM + "/?rdid=j1pqIFqnN6Lie2AD&share_url=whatever"

    class _Resp:
        url = landed

    class _Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def head(self, url):
            assert url == WRAPPER, "must follow the wrapper, not something else"
            return _Resp()

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    assert await resolve_permalink(WRAPPER) == ALBUM


# --------------------------------------------- the album behind the wall


def _walled_html(post_id_=POST_ID, count=4, neighbour=True):
    """The shape Facebook's payload actually uses: `&amp;` in anchors and
    `\u0026` in the embedded JSON, plus a neighbouring post's photo."""
    parts = []
    for i in range(count):
        sep = "&amp;" if i % 2 else "\u0026"
        parts.append(
            f'<a href="/photo/?fbid=1000{i}00000{sep}set=pcb.{post_id_}">p</a>'
        )
    if neighbour:
        parts.append('<a href="/photo/?fbid=999999999&amp;set=pcb.8888888888">n</a>')
    return "<html>" + "".join(parts) + "</html>"


def test_the_post_id_comes_out_of_the_permalink():
    assert post_id(ALBUM) == POST_ID
    assert post_id("https://www.facebook.com/groups/x/posts/3525920920918294/") == POST_ID
    assert post_id("https://www.facebook.com/") is None


def test_only_this_posts_photos_are_read():
    """The anchoring that replaces the DOM scope. A neighbouring post's photo
    set carries a different id and must never be collected — that is the exact
    failure the whole scoping layer exists to prevent."""
    photos = album_photos(_walled_html(), ALBUM)
    assert len(photos) == 4
    assert all(p["type"] == "image" for p in photos)
    assert MEDIA_URL.format("999999999") not in [p["url"] for p in photos]


def test_a_repeated_photo_is_counted_once():
    html = _walled_html(count=1, neighbour=False) * 3
    assert len(album_photos(html, ALBUM)) == 1


def test_nothing_is_invented_when_the_payload_is_absent():
    """A post with no photo set, a page that is not a post, empty html. Each
    must return nothing so the caller behaves exactly as it did before."""
    assert album_photos("<html></html>", ALBUM) == []
    assert album_photos(_walled_html(), "https://www.facebook.com/") == []
    assert album_photos("", ALBUM) == []


# ---------------------------------------------------------- the decision


def test_the_walled_album_is_typed_image_not_video():
    """The whole point, exercised end to end at the decision itself: an
    UNSCOPED read on a video host, which is what a Facebook wall produces,
    plus the payload photos, must answer `image` and carry a gallery."""
    photos = album_photos(_walled_html(), ALBUM)
    memo_type = classify_media(photos, scoped=False, post_text="", fallback="video")
    assert memo_type == "image"
    assert len(slides(photos) or []) == 4


def test_a_post_with_no_photos_still_falls_back_to_video():
    """The fallback stays. A private or region-locked Facebook video reaches
    here with no evidence either, and guessing anything else loses a real one."""
    assert classify_media([], scoped=False, fallback="video") == "video"
