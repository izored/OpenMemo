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


# ------------------------------------------- a player that has not loaded yet


def test_an_unloaded_player_is_still_a_video():
    """Facebook mounts <video> with no src and no poster until you press play.
    Typing the item from its src made a shared video post come out as a
    bookmark, which is the same class of bug as typing it from the domain."""
    assert classify_media([{"url": "", "type": "video"}], scoped=True,
                          post_text="a caption", fallback="link") == "video"


def test_an_unloaded_player_does_not_shadow_the_still_behind_it():
    assert cover([{"url": "", "type": "video", "poster": ""},
                  {"url": "https://cdn/a.jpg", "type": "image"}]) == "https://cdn/a.jpg"


def test_a_player_with_a_poster_still_covers_the_card():
    assert cover([{"url": "", "type": "video", "poster": "p.jpg"}]) == "p.jpg"


def test_an_unloaded_player_is_not_a_gallery_slide():
    """It names no picture, so there is nothing to render in a carousel. The
    stills around it still make one."""
    media = [{"url": "", "type": "video"},
             {"url": "a.jpg", "type": "image"},
             {"url": "b.jpg", "type": "image"}]
    assert slides(media) == [{"url": "a.jpg", "type": "image"},
                             {"url": "b.jpg", "type": "image"}]
    assert slides([{"url": "", "type": "video"}]) is None


def test_both_readers_of_a_scope_agree_on_what_a_player_is():
    """The download path counts <video> ELEMENTS (sniff_media's probe sets
    `out.count = vids.length`). The typing path used to require a src, so one
    said "there is a clip here" while the other said "no media at all"."""
    from backend.core import headless, sniff_media

    assert "out.count = vids.length" in sniff_media._PLAY_AND_PROBE_JS
    assert "type = src ? 'video' : 'image'" not in headless._SCOPE_MEDIA_JS


def test_the_download_path_also_rescopes_a_share_link():
    """A share link left the capture unscoped, and an unscoped capture picks
    the biggest media on the wire, which on a permalink page is a neighbour's
    clip. Both readers now take the same second look."""
    from backend.core import sniff_media

    assert sniff_media._landed_rescope is not None


# ------------------------------------------------ an album with a clip in it


def test_a_mixed_album_is_an_image_post():
    """Three photos and a clip is an album, not a video. One clip outranking any
    number of photos filed it as a video, and then nothing rendered it: both
    gallery branches on the memo page ask for an image memo, so the slides were
    downloaded, stored, served and shown by nobody, behind a player with nothing
    to play. Same rule the Instagram path already applies."""
    media = [{"url": "a.jpg", "type": "image"},
             {"url": "", "type": "video"},
             {"url": "b.jpg", "type": "image"},
             {"url": "c.jpg", "type": "image"}]
    assert classify_media(media, scoped=True, post_text="cap", fallback="video") == "image"
    assert len(slides(media)) == 3


def test_a_post_that_is_only_players_is_still_a_video():
    """The other half of the rule, and the one that must not regress: a lone
    Facebook player mounts with no src and no poster, and it is still a video."""
    assert classify_media([{"url": "", "type": "video"}], scoped=True,
                          post_text="cap", fallback="link") == "video"
    assert classify_media([{"url": "a.mp4", "type": "video"},
                           {"url": "b.mp4", "type": "video"}]) == "video"
    assert slides([{"url": "a.mp4", "type": "video"},
                   {"url": "b.mp4", "type": "video"}]) is None


def test_a_clip_at_the_front_does_not_take_the_cover():
    """Facebook puts the clip wherever it likes in the grid. An unloaded player
    names no picture, so the cover is the first photo behind it."""
    media = [{"url": "", "type": "video"},
             {"url": "a.jpg", "type": "image"},
             {"url": "b.jpg", "type": "image"}]
    assert classify_media(media, scoped=True, post_text="cap") == "image"
    assert cover(media) == "a.jpg"


def test_the_shared_rule_matches_the_instagram_one():
    """`_instagram_resolve` decides this with `all_video = bool(slides) and not
    stills`. Two spellings of one rule is how they drifted apart in the first
    place, so this pins them together."""
    import inspect

    from backend.core import extractor

    src = inspect.getsource(extractor._instagram_resolve)
    assert "all_video = bool(slides) and not stills" in src


# ------------------------------------------- the thumbnail is not the photo

# The real shapes, from a live Facebook album on 2026-09-04. Both numbers ride
# on the same URL: `cstp=mx` is the biggest rendition that exists, `ctp=s` the
# one being served.
_GRID = (
    "https://scontent-bru2-1.xx.fbcdn.net/v/t51.82787-15/793551200_n.jpg"
    "?stp=dst-jpg_tt6&cstp=mx2000x2000&ctp=s590x590&_nc_cat=108"
)
_FULL = (
    "https://scontent-bru2-1.xx.fbcdn.net/v/t51.82787-15/793551200_n.jpg"
    "?stp=dst-jpg_tt6&cstp=mx2000x2000&ctp=s2000x2000&_nc_cat=108"
)


def test_a_feed_thumbnail_knows_a_bigger_one_exists():
    """Saving the 590px preview of a 2000px photo is a loss that cannot be
    undone later: the CDN URL expires and the original goes with it."""
    from backend.core.headless import _underserved

    assert _underserved(_GRID) is True
    assert _underserved(_FULL) is False


def test_a_url_that_says_nothing_about_size_is_left_alone():
    """No claim, no page load. This is what keeps every other host free."""
    from backend.core.headless import _underserved

    assert _underserved("https://cdn.example.com/photo.jpg") is False
    assert _underserved("") is False


def test_a_marginal_gain_is_not_worth_a_page_load():
    from backend.core.headless import _underserved

    assert _underserved("https://cdn/a.jpg?cstp=mx640x640&ctp=s600x600") is False
    assert _underserved("https://cdn/a.jpg?cstp=mx1200x1200&ctp=s600x600") is True


def test_served_pixels_reads_what_the_url_is_handing_over():
    from backend.core.headless import _served_pixels

    assert _served_pixels(_GRID) == 590 * 590
    assert _served_pixels(_FULL) == 2000 * 2000
    assert _served_pixels("https://cdn/a.jpg") == 0


def test_a_still_carries_the_link_to_its_own_photo_page():
    """The full rendition is only reachable where Facebook published it, and the
    grid already links there. Same-origin, so a link out of the post can never
    become the thing we fetch."""
    from backend.core import headless

    assert "link: link" in headless._SCOPE_MEDIA_JS
    assert "closest('a[href]')" in headless._SCOPE_MEDIA_JS
    assert "abs.origin === location.origin" in headless._SCOPE_MEDIA_JS


def test_the_full_image_reader_scores_natural_pixels():
    """Rendered size is whatever the viewer chose. The file behind it is the
    point, so `_LARGEST_IMAGE_JS`'s bounding-box score is the wrong one here."""
    from backend.core import headless

    assert "naturalWidth * img.naturalHeight" in headless._FULL_IMAGE_JS


def test_the_gallery_does_not_carry_the_permalink_into_the_memo():
    """`link` is scaffolding for the upgrade pass, not memo data."""
    media = [{"url": "a.jpg", "type": "image", "link": "https://fb/photo/?fbid=1"},
             {"url": "b.jpg", "type": "image", "link": "https://fb/photo/?fbid=2"}]
    assert slides(media) == [{"url": "a.jpg", "type": "image"},
                             {"url": "b.jpg", "type": "image"}]


def test_the_scope_script_takes_one_argument():
    """Playwright hands `evaluate` a single argument, so the script has to
    destructure. Passing two parameters silently binds `kind` to undefined and
    every scope attempt returns false."""
    from backend.core import headless

    assert headless._SCOPE_POST_JS.startswith("([wantPrefix, kind]) =>")


# ------------------------------------------- one post, two names for it


def test_the_scope_falls_back_when_the_page_uses_a_different_id():
    """Facebook labels one post with TWO stable pfbids: the one a share link
    redirects to, and a different one in the page's own link back to itself.
    Verified twice on a live album, 2026-09-04. The strict prefix test matches
    neither, so the post was read as the page around it and every re-pull
    quietly changed nothing."""
    from backend.core import headless

    js = headless._SCOPE_POST_JS
    assert "const cands = new Set();" in js
    assert "want = Array.from(cands)[0];" in js


def test_the_fallback_refuses_when_there_is_more_than_one_candidate():
    """Being the ONLY candidate is the whole safety argument. A feed of other
    posts is what produces several, which is the case the strict test exists
    for, and Reddit, Threads and Instagram permalink pages all list
    neighbouring posts, so they never take this path at all."""
    from backend.core import headless

    assert "if (cands.size !== 1) return false;" in headless._SCOPE_POST_JS


def test_the_fallback_only_considers_this_authors_posts():
    """A candidate has to share the author AND the kind, not merely the kind.
    A "more from around the web" link is not this post under another name."""
    from backend.core import headless

    js = headless._SCOPE_POST_JS
    assert "const stem = want0.slice(0, at + kind.length + 2);" in js
    assert "p.startsWith(stem)" in js


def test_reassigning_want_carries_the_foreign_test_with_it():
    """`mine` and `foreign` both close over `want`, so the ancestor walk has to
    measure against the id the PAGE uses, not the one we arrived with. A `const`
    here would have made the fallback find a self-link and then treat it as a
    stranger."""
    from backend.core import headless

    assert "let want = want0;" in headless._SCOPE_POST_JS


# --------------------------------------------- a failed read says so now


def test_a_scope_that_failed_is_recorded_rather_than_inferred():
    """An unscoped read is a quiet degradation, not an error: the page parses,
    the memo saves, and the only symptom is a re-pull that returns 200 and
    changes nothing. A Facebook album sat wrong through six of those."""
    from backend.core.social import SCOPE_TIER_PAGE, SCOPE_TIER_POST, SCOPE_TIERS

    assert SCOPE_TIER_POST != SCOPE_TIER_PAGE
    assert set(SCOPE_TIERS) == {SCOPE_TIER_POST, SCOPE_TIER_PAGE}


def test_the_scoped_path_reports_which_read_answered():
    import inspect

    from backend.core import extractor

    src = inspect.getsource(extractor.extract_video)
    assert 'result["resolve_tier"] = SCOPE_TIER_POST if scoped else SCOPE_TIER_PAGE' in src
    # Only when a scope was attempted. A URL naming no post was never going to
    # be narrowed and must not be reported as a degraded read.
    assert "if scope:" in src
