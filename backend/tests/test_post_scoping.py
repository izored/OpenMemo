"""One post, not the feed around it, on every network.

The Threads carousel bug (see test_threads_carousel) was never a Threads bug.
Reddit, X, TikTok and Bluesky all render a permalink as one post surrounded by
other posts, and all of them were typed from the domain rather than from what
the post holds. These cover the two shared pieces that fix it everywhere:
`core/permalinks` (which URLs name one post, and how to match the page's own
links to it) and `core/social` (what the post's contents make the memo).
"""
import pytest

from backend.core.permalinks import canonical_post_url, is_post_permalink, post_scope
from backend.core.social import apply_media, classify_media, cover, slides


# --------------------------------------------------------------- URL shapes


@pytest.mark.parametrize(
    "url,prefix,kind",
    [
        (
            "https://www.threads.com/@medallomami_/post/Dcq6Ff4DHeR",
            "/@medallomami_/post/Dcq6Ff4DHeR",
            "post",
        ),
        (
            "https://www.reddit.com/r/pics/comments/1abcdef/a_very_long_title_slug/",
            "/r/pics/comments/1abcdef",
            "comments",
        ),
        ("https://x.com/jack/status/20", "/jack/status/20", "status"),
        (
            "https://twitter.com/jack/status/20?s=46&t=xyz",
            "/jack/status/20",
            "status",
        ),
        ("https://www.instagram.com/p/DAbc123xyz/", "/p/DAbc123xyz", "p"),
        (
            "https://www.instagram.com/someone/reel/DAbc123xyz/",
            "/someone/reel/DAbc123xyz",
            "reel",
        ),
        (
            "https://www.tiktok.com/@user/video/7123456789",
            "/@user/video/7123456789",
            "video",
        ),
        (
            "https://bsky.app/profile/alice.bsky.social/post/3kabcdef",
            "/profile/alice.bsky.social/post/3kabcdef",
            "post",
        ),
        # Facebook, in the spellings a memo actually arrives in. The share
        # wrapper is the only link Facebook offers for a multi-photo post.
        (
            "https://www.facebook.com/share/p/1MKkkWnVcG/",
            "/share/p/1MKkkWnVcG",
            "p",
        ),
        (
            "https://www.facebook.com/share/v/1MKkkWnVcG/",
            "/share/v/1MKkkWnVcG",
            "v",
        ),
        (
            "https://www.facebook.com/HuePhilips/posts/pfbid02g45nVnqBfvJev?rdid=x",
            "/HuePhilips/posts/pfbid02g45nVnqBfvJev",
            "posts",
        ),
        (
            "https://www.facebook.com/HuePhilips/videos/1129791406044705/",
            "/HuePhilips/videos/1129791406044705",
            "videos",
        ),
        (
            "https://www.facebook.com/groups/123456/posts/7890123/",
            "/groups/123456/posts/7890123",
            "posts",
        ),
    ],
)
def test_a_permalink_yields_its_prefix_and_kind(url, prefix, kind):
    scope = post_scope(url)
    assert scope is not None, url
    assert scope["prefix"] == prefix
    assert scope["kind"] == kind


def test_reddits_title_slug_is_dropped_from_the_prefix():
    """Reddit spells the same post both ways. Matching the page's own anchors
    has to be a prefix test, or the scope finds no self-link and gives up."""
    bare = "https://www.reddit.com/r/pics/comments/1abcdef"
    slugged = "https://www.reddit.com/r/pics/comments/1abcdef/a_title_here/"
    assert post_scope(bare)["prefix"] == post_scope(slugged)["prefix"]


def test_a_reddit_comment_deep_link_still_names_the_post():
    deep = "https://www.reddit.com/r/pics/comments/1abcdef/a_title/lz9k2m1/"
    assert post_scope(deep)["prefix"] == "/r/pics/comments/1abcdef"


def test_tracking_parameters_are_dropped():
    assert canonical_post_url("https://x.com/jack/status/20?s=46") == (
        "https://x.com/jack/status/20"
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://www.reddit.com/r/pics/",
        "https://www.threads.com/@medallomami_",
        "https://x.com/jack",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://example.com/",
        "https://example.com/blog/p/hi",
        "",
    ],
)
def test_a_feed_or_a_profile_is_not_a_permalink(url):
    """Scoping a page with no single post to narrow to can only mislead, so
    these must not match. `/blog/p/hi` is the near miss: too short to be an id."""
    assert not is_post_permalink(url)


def test_a_url_that_is_not_a_post_passes_through_unchanged():
    assert canonical_post_url("https://example.com/a?b=c") == "https://example.com/a?b=c"


# ------------------------------------------------------------------- typing


def test_a_clip_inside_the_post_makes_it_a_video():
    media = [{"url": "https://cdn/a.mp4", "type": "video"}]
    assert classify_media(media) == "video"


def test_stills_inside_the_post_make_it_an_image():
    media = [{"url": "https://cdn/a.jpg", "type": "image"}]
    assert classify_media(media, fallback="video") == "image"


def test_a_scoped_post_with_text_and_no_media_is_a_link():
    """A Reddit self-post or a plain tweet. It used to become a video memo with
    nothing to play, and the downloader then went looking for something."""
    assert classify_media([], scoped=True, post_text="three sentences") == "link"


def test_an_unscoped_page_keeps_the_old_answer():
    """The whole safety story. If the scope failed we learned nothing, so a
    private or region-locked video must not be downgraded to a bookmark."""
    assert classify_media([], scoped=False, post_text="", fallback="video") == "video"


def test_an_empty_scope_is_not_evidence_of_a_text_post():
    assert classify_media([], scoped=True, post_text="   ", fallback="video") == "video"


def test_og_video_outranks_an_empty_scope():
    assert classify_media([], og_video="https://cdn/a.mp4", scoped=True,
                          post_text="hi", fallback="link") == "video"


# ------------------------------------------------------- gallery and cover


def test_two_or_more_items_make_a_gallery():
    media = [{"url": "a.jpg", "type": "image"}, {"url": "b.jpg", "type": "image"}]
    assert slides(media) == [
        {"url": "a.jpg", "type": "image"},
        {"url": "b.jpg", "type": "image"},
    ]


def test_a_single_item_is_not_a_gallery():
    assert slides([{"url": "a.jpg", "type": "image"}]) is None


def test_a_videos_poster_is_the_cover():
    media = [{"url": "a.mp4", "type": "video", "poster": "p.jpg"}]
    assert cover(media) == "p.jpg"


def test_apply_media_does_not_overwrite_a_cover_already_found():
    memo = {"thumbnail_path": "https://cdn/better.jpg"}
    apply_media(memo, [{"url": "a.jpg", "type": "image"}, {"url": "b.jpg", "type": "image"}])
    assert memo["thumbnail_path"] == "https://cdn/better.jpg"
    assert len(memo["gallery"]) == 2


def test_apply_media_on_an_empty_post_changes_nothing():
    memo = {"thumbnail_path": ""}
    apply_media(memo, [])
    assert memo == {"thumbnail_path": ""}


# ------------------------------------------------------ downstream agreement


@pytest.mark.parametrize(
    "url",
    [
        "https://www.reddit.com/r/pics/comments/1abcdef/a_title/",
        "https://x.com/jack/status/20",
        "https://www.tiktok.com/@user/video/7123456789",
    ],
)
def test_the_sorter_leaves_a_resolved_text_post_alone(url):
    """`detect_url_type` says video for all three hosts, from the domain alone.
    The scoped read already looked inside the post, so its answer has to hold."""
    from backend.core.classify import derive_memo_type

    class _Memo:
        file_path = None
        source_url = url
        type = "link"

    assert derive_memo_type(_Memo()) == "link"


def test_a_video_host_with_no_permalink_still_defaults_to_video():
    """Nothing read this post, so nothing overrides the domain."""
    from backend.core.classify import derive_memo_type

    class _Memo:
        file_path = None
        source_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        type = "link"

    assert derive_memo_type(_Memo()) == "video"


# ------------------------------------------------- share links that redirect


def test_facebooks_share_wrapper_is_not_read_as_an_instagram_post():
    """`/share/p/<code>` is Facebook's, and Instagram's `/p/` shape claims it
    unless Facebook's sits above it. The two that prove the ordering are the
    video and reel wrappers, which Instagram's alternation cannot match at
    all — before this they were not permalinks and so were never scoped."""
    for code in ("v", "r", "g"):
        assert is_post_permalink(f"https://www.facebook.com/share/{code}/1MKkkWnVcG/")


def test_a_redirect_wrapper_is_rescoped_from_where_it_landed():
    """The whole Facebook album fix. `/share/p/<code>` names the post and
    appears nowhere inside it, so the first scope pass matches nothing; the
    pfbid permalink the browser lands on is the spelling the page's own anchors
    use."""
    from backend.core.headless import _landed_rescope

    share = "https://www.facebook.com/share/p/1MKkkWnVcG"
    landed = (
        "https://www.facebook.com/HuePhilips/posts/pfbid02g45nVnqBfvJev/"
        "?rdid=Kqn6Osd5S59NgTrr"
    )
    assert _landed_rescope(share, landed) == landed


def test_a_page_that_did_not_redirect_is_not_scoped_twice():
    """The common path pays one string compare, not a second DOM walk."""
    from backend.core.headless import _landed_rescope

    url = "https://www.threads.com/@medallomami_/post/Dcq6Ff4DHeR"
    assert _landed_rescope(url, url) is None
    assert _landed_rescope(url, url + "/") is None
    assert _landed_rescope(url, "") is None


def test_landing_somewhere_that_is_not_a_post_is_not_worth_retrying():
    """A dead share link lands on a login screen or a feed. Scoping that can
    only narrow to a stranger's post, so it must not be attempted."""
    from backend.core.headless import _landed_rescope

    share = "https://www.facebook.com/share/p/1MKkkWnVcG"
    assert _landed_rescope(share, "https://www.facebook.com/login/") is None
    assert _landed_rescope(share, "https://www.facebook.com/") is None


def test_a_four_photo_album_is_an_image_memo_with_a_gallery():
    """What the scoped read makes of the Philips Hue post that started this:
    four stills, no player, so an image memo whose gallery holds all four —
    not a video card with nothing to play."""
    media = [{"url": f"https://cdn/{i}.jpg", "type": "image"} for i in range(4)]
    memo = {"thumbnail_path": ""}
    assert classify_media(media, scoped=True, fallback="video") == "image"
    apply_media(memo, media)
    assert memo["thumbnail_path"] == "https://cdn/0.jpg"
    assert len(memo["gallery"]) == 4


def test_the_scope_script_takes_one_argument():
    """Playwright hands `evaluate` a single argument, so the script has to
    destructure. Passing two parameters silently binds `kind` to undefined and
    every scope attempt returns false."""
    from backend.core import headless

    assert headless._SCOPE_POST_JS.startswith("([wantPrefix, kind]) =>")
