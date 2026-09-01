"""A Threads carousel is six photos, not one stranger's video.

Regression cover for the live post that produced all three failures at once
(threads.com/@medallomami_/post/Dcq6Ff4DHeR, saved 2026-08-30, diagnosed
2026-09-01): a six-photo carousel arrived as a `video` memo holding a 1.4 MB mp4
from a different author's post, with Meta's cookie-consent screen as its body.

No network. The OpenGraph fetch and the headless render are stubbed with what
the live page actually returned, so what is under test is the shape of the memo
that comes out of those inputs.
"""
import pytest

from backend.core.headless import _looks_like_consent_wall
from backend.core.social import slides as _slides
from backend.core.threads import (
    THREADS_TIER_SCOPED,
    canonical_permalink,
    classify,
    is_threads_url,
    resolve_threads,
)

PERMALINK = "https://www.threads.com/@medallomami_/post/Dcq6Ff4DHeR"
SHARE = "https://www.threads.com/share/BAW0Di4fps/"

# The six carousel slides as the scoped render reads them, full-res.
SIX_PHOTOS = [
    {"url": f"https://scontent.cdninstagram.com/v/t51.82787-15/slide{i}.jpg", "type": "image", "poster": ""}
    for i in range(1, 7)
]

# What the crawler UA gets back. og:image is Threads' generated preview CARD,
# not a slide, and there is no og:video — this post has no video at all.
OG = {
    "title": "mareana (@medallomami_) on Threads",
    "description": "cocktail?",
    "thumbnail_path": "https://scontent.xx.fbcdn.net/v/t39.92108-6/preview-card.jpg",
    "video_url": "",
    "og_url": PERMALINK,
}

# Verbatim opening of the consent screen that became the memo's content_text.
CONSENT_TEXT = """[Log in](https://www.threads.com/login?show_choice_screen=false)

Allow the use of cookies from Threads by Instagram on this browser?

We use cookies and similar technologies to help provide and improve content on
Meta Products. We also use them to provide a safer experience.

Your cookie choices

Cookies from other companies

Allow all cookies

Decline optional cookies"""


@pytest.fixture
def stub_resolver(monkeypatch):
    """Wire resolve_threads to fixed OpenGraph + render answers.

    Returns a dict the test mutates to choose what the render found, so one
    fixture covers the carousel, the video post and the text post.
    """
    state = {"post_media": list(SIX_PHOTOS), "main_image": None, "consent_wall": False}

    async def _og(url, user_agent=None):
        return dict(OG)

    async def _render(url, **kwargs):
        state["rendered_url"] = url
        state["scope"] = kwargs.get("scope_permalink")
        return {
            "html": "",
            "post_media": state["post_media"],
            "main_image": state["main_image"],
            "consent_wall": state["consent_wall"],
            "scoped": True,
            "slides": [],
        }

    monkeypatch.setattr("backend.core.extractor._fetch_og_meta", _og)
    monkeypatch.setattr("backend.core.headless.render_page", _render)
    return state


# --------------------------------------------------------------------- URLs


def test_threads_urls_are_recognised_on_both_domains():
    assert is_threads_url(PERMALINK)
    assert is_threads_url("https://www.threads.net/@x/post/ABC")
    assert not is_threads_url("https://www.instagram.com/p/ABC/")


def test_a_share_link_becomes_the_real_permalink():
    """The share sheet hands out /share/<code>/, which names no author and no
    post — nothing the scope pass can match. og:url is the way back."""
    assert canonical_permalink(SHARE, PERMALINK) == PERMALINK


def test_tracking_params_never_make_one_post_look_like_two():
    noisy = PERMALINK + "?xmt=AQG0xp4tfRYpmo&slof=1"
    assert canonical_permalink(noisy) == PERMALINK


# ------------------------------------------------------------------- typing


def test_a_photo_carousel_is_not_a_video():
    """The whole bug in one assertion. The domain is on the video host list;
    the post is six photographs."""
    assert classify(SIX_PHOTOS, og_video="") == "image"


def test_a_post_with_its_own_player_is_a_video():
    media = [{"url": "https://cdn/clip.mp4", "type": "video", "poster": "https://cdn/p.jpg"}]
    assert classify(media, og_video="") == "video"


def test_a_text_post_is_a_link_not_an_empty_video():
    assert classify([], og_video="") == "link"


def test_og_video_still_types_a_post_the_render_could_not_reach():
    assert classify([], og_video="https://cdn/clip.mp4") == "video"


# ------------------------------------------------------------------ gallery


def test_every_slide_lands_in_the_gallery():
    gallery = _slides(SIX_PHOTOS)
    assert gallery is not None
    assert [s["url"] for s in gallery] == [m["url"] for m in SIX_PHOTOS]
    assert {s["type"] for s in gallery} == {"image"}


def test_a_single_photo_post_has_no_gallery():
    assert _slides(SIX_PHOTOS[:1]) is None


def test_a_sidecar_of_clips_keeps_no_gallery():
    """Expiring CDN mp4 URLs are not renderable slides — same rule the
    Instagram resolver applies."""
    clips = [{"url": f"https://cdn/{i}.mp4", "type": "video"} for i in range(3)]
    assert _slides(clips) is None


def test_a_mixed_post_keeps_its_gallery():
    mixed = SIX_PHOTOS[:2] + [{"url": "https://cdn/c.mp4", "type": "video"}]
    gallery = _slides(mixed)
    assert gallery is not None and len(gallery) == 3


# ------------------------------------------------------------- consent gate


def test_the_cookie_screen_is_recognised_as_a_gate():
    assert _looks_like_consent_wall(CONSENT_TEXT)


def test_an_ordinary_article_is_not_a_gate():
    assert not _looks_like_consent_wall(
        "A long piece about espresso. It mentions cookies once, the edible kind."
    )


def test_a_page_that_merely_explains_cookies_is_not_a_gate():
    """A cookie POLICY describes cookies but carries no decision buttons in its
    body. Writing it off as a gate would lose a page the user meant to keep."""
    assert not _looks_like_consent_wall(
        "About cookies. We use cookies and similar technologies across our "
        "services. This page explains what they are and how long they last."
    )


# ------------------------------------------------------- the whole resolver


@pytest.mark.asyncio
async def test_the_carousel_resolves_to_six_slides(stub_resolver):
    memo = await resolve_threads(SHARE, "threads.com")

    assert memo["type"] == "image"
    assert len(memo["gallery"]) == 6
    assert memo["resolve_tier"] == THREADS_TIER_SCOPED
    # The card shows slide one, not Meta's generated preview card.
    assert memo["thumbnail_path"] == SIX_PHOTOS[0]["url"]
    assert memo["thumbnail_path"] != OG["thumbnail_path"]


@pytest.mark.asyncio
async def test_the_body_is_the_caption_not_the_cookie_policy(stub_resolver):
    memo = await resolve_threads(SHARE, "threads.com")

    assert memo["content_text"] == "cocktail?"
    assert "cookies" not in memo["content_text"].lower()


@pytest.mark.asyncio
async def test_the_render_is_scoped_to_the_post(stub_resolver):
    """Without a scope the readers answer with the "Related threads" feed
    underneath, which is where the stranger's mp4 came from."""
    await resolve_threads(SHARE, "threads.com")

    assert stub_resolver["scope"] == PERMALINK
    assert stub_resolver["rendered_url"] == PERMALINK


@pytest.mark.asyncio
async def test_a_text_post_keeps_no_fake_photo(stub_resolver):
    stub_resolver["post_media"] = []
    memo = await resolve_threads(PERMALINK, "threads.com")

    assert memo["type"] == "link"
    # og:image here is the generated preview card; hanging it on a quote card
    # would claim a picture the post does not have.
    assert memo["thumbnail_path"] == ""


@pytest.mark.asyncio
async def test_a_consent_gate_still_leaves_a_titled_memo(stub_resolver):
    stub_resolver["post_media"] = []
    stub_resolver["consent_wall"] = True
    memo = await resolve_threads(PERMALINK, "threads.com")

    assert memo["title"] == OG["title"]
    assert memo["content_text"] == "cocktail?"


# ------------------------------------------------ the consent click is safe


def _consent_labels() -> list[str]:
    """The label list `_DISMISS_CONSENT_JS` matches on, read from the source.

    Asserting against the real constant rather than a copy: a label added to the
    JS without thinking is exactly the change this test exists to catch."""
    import re

    from backend.core import headless

    body = re.search(r"const wanted = \[(.*?)\];", headless._DISMISS_CONSENT_JS, re.S)
    assert body, "the consent script no longer declares a `wanted` list"
    return re.findall(r"'([^']+)'", body.group(1))


def test_the_consent_click_can_only_ever_refuse():
    """Dismissing a cookie banner clicks on the user's behalf, so the list has
    to be incapable of accepting one. Every accept-shaped label a real banner
    offers must miss."""
    labels = _consent_labels()
    accepting = [
        "allow all cookies",
        "accept all cookies",
        "accept all",
        "accept",
        "agree",
        "i agree",
        "got it",
        "ok",
        "allow all",
        "enable all cookies",
    ]
    for button in accepting:
        assert not any(want in button for want in labels), (
            f"the consent script would click {button!r}"
        )


def test_metas_own_decline_button_is_covered():
    labels = _consent_labels()
    assert any(want in "decline optional cookies" for want in labels)


def test_an_unrelated_decline_is_left_alone():
    """"Decline" on its own was in the list once. A meeting invite is not a
    cookie banner."""
    labels = _consent_labels()
    for button in ("decline invitation", "decline this request", "decline"):
        assert not any(want in button for want in labels)


# ---------------------------------------------------- downstream agreement


def test_the_sorter_leaves_a_threads_text_post_alone():
    """`detect_url_type` says "video" for threads.com from the domain alone.
    The resolver already read the post, so its verdict has to survive."""
    from backend.core.classify import derive_memo_type

    class _Memo:
        file_path = None
        source_url = PERMALINK
        type = "link"

    assert derive_memo_type(_Memo()) == "link"


def test_a_threads_photo_post_stays_a_photo():
    from backend.core.classify import derive_memo_type

    class _Memo:
        file_path = None
        source_url = PERMALINK
        type = "image"

    assert derive_memo_type(_Memo()) == "image"


def test_only_a_post_permalink_is_worth_scoping():
    """A profile or a homepage has no single post to narrow to; passing one
    would cost a lookup that can only miss."""
    from backend.core.localize_media import _post_permalink

    assert _post_permalink(PERMALINK) == PERMALINK
    assert _post_permalink("https://www.instagram.com/p/DAbc123/") is not None
    assert _post_permalink("https://www.threads.com/@medallomami_") is None
    assert _post_permalink("https://example.com/") is None
