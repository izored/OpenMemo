"""Post permalinks: which URLs name ONE item rather than a feed.

Every social permalink page is the same trap. The URL names a single post, the
page renders that post surrounded by a feed of OTHER posts, and any host-blind
reader (largest image, stage image, play every video) happily answers with a
neighbour. A six-photo Threads carousel was saved as a stranger's video clip
exactly this way.

The cure is to scope the read to the post's own subtree before anything looks at
the page, and that needs two things out of the URL:

  * `prefix` — the part of the path that identifies the post, with the trailing
    slug and any query dropped. Reddit spells the same post as both
    `/r/x/comments/abc` and `/r/x/comments/abc/a_long_title/`, so matching the
    page's own anchors has to be a prefix test, not string equality.
  * `kind`   — the token immediately before the id (`post`, `p`, `status`,
    `comments`, `video`). This is what makes "another post's link" detectable
    without knowing which site is being read: any anchor carrying `/<kind>/`
    that is not this post's is somebody else's.

Both come from the URL alone, so the DOM walk that uses them (headless._scope_post)
stays completely host-blind. Adding a network is one line in `_SHAPES`, and a
network that is missing here simply does not get scoped — the old whole-page
behaviour, which is the safe direction to fail in.

ADR: this is the shared abstraction the "scope is the memo type, not the one
provider" decision asks for. No caller does per-host permalink parsing.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse, urlunparse

# Post-permalink shapes, most specific first. Each must capture a `prefix` group
# spanning host-path-start through the post id and no further: the slug Reddit
# and Bluesky append is decoration, and a comment deep-link below the post still
# belongs to the post.
#
# Ids are required to be id-shaped (a run of code characters, or digits) so an
# ordinary page at `/blog/p/hello` is not mistaken for a permalink. A shape that
# matches something that is not a post costs nothing worse than a scope that
# finds no anchor and is discarded, but there is no reason to invite it.
_SHAPES = (
    # Threads — /@user/post/<code>
    re.compile(r"^(?P<prefix>/@[^/]+/post/[A-Za-z0-9_-]{5,})", re.I),
    # Bluesky — /profile/<handle>/post/<rkey>
    re.compile(r"^(?P<prefix>/profile/[^/]+/post/[A-Za-z0-9]{5,})", re.I),
    # Facebook share sheet — /share/p|v|r|g/<code>. Must sit ABOVE Instagram,
    # whose /p/ shape happily claims /share/p/ and hands back the kind "p".
    # This is the only link Facebook offers for a multi-photo post: the post's
    # own Share menu has no copy-link entry, so the URL has to be fished out of
    # a saved collection. The code names neither the author nor the post and
    # therefore matches nothing on the rendered page — the render re-scopes from
    # the URL the redirect lands on (headless.render_page).
    re.compile(r"^(?P<prefix>/share/(?:p|v|r|g)/[A-Za-z0-9_-]{5,})", re.I),
    # Instagram — /p/, /reel/, /reels/, /tv/, optionally under a username
    re.compile(r"^(?P<prefix>(?:/[^/]+)?/(?:p|reel|reels|tv)/[A-Za-z0-9_-]{5,})", re.I),
    # TikTok — /@user/video/<id>, /@user/photo/<id>
    re.compile(r"^(?P<prefix>/@[^/]+/(?:video|photo)/\d+)", re.I),
    # X / Twitter / Mastodon — /<user>/status/<id>, /<user>/statuses/<id>
    re.compile(r"^(?P<prefix>/[^/]+/status(?:es)?/\d+)", re.I),
    # Reddit — /r/<sub>/comments/<id>[/<slug>[/<comment id>]]
    re.compile(r"^(?P<prefix>/r/[^/]+/comments/[A-Za-z0-9]{4,})", re.I),
    # Facebook groups — /groups/<gid>/posts/<pid>, ahead of the generic shape
    # below, which reads "groups" as the username and then finds no /posts/.
    re.compile(r"^(?P<prefix>/groups/[^/]+/posts/[A-Za-z0-9.]{5,})", re.I),
    # Facebook — /<user>/posts/<id>, /<user>/videos/<id>. The id is the pfbid
    # spelling a share link redirects to, which is also the spelling the page's
    # own anchors use.
    re.compile(r"^(?P<prefix>/[^/]+/(?:posts|videos)/[A-Za-z0-9.]{5,})", re.I),
)


def post_scope(url: str) -> dict | None:
    """`{"url", "prefix", "kind"}` when `url` names one post, else None.

    `url` comes back normalized: scheme and host preserved, path truncated to
    the prefix, query and fragment dropped. That is the form to hand to the
    renderer, so a share-sheet's tracking parameters cannot make one post look
    like two."""
    try:
        parts = urlparse(url or "")
    except Exception:
        return None
    path = parts.path or ""
    if not path:
        return None

    for shape in _SHAPES:
        m = shape.match(path)
        if not m:
            continue
        prefix = m.group("prefix").rstrip("/")
        segments = [s for s in prefix.split("/") if s]
        if len(segments) < 2:
            continue
        return {
            "url": urlunparse(parts._replace(path=prefix, query="", fragment="")),
            "prefix": prefix,
            # The token before the id. `/r/x/comments/abc` -> "comments",
            # `/u/status/1` -> "status", `/@u/post/C` -> "post".
            "kind": segments[-2],
        }
    return None


def is_post_permalink(url: str) -> bool:
    """True when `url` names a single post rather than a feed or a profile."""
    return post_scope(url) is not None


def canonical_post_url(url: str) -> str:
    """`url` reduced to its permalink, or `url` unchanged when it is not one."""
    scope = post_scope(url)
    return scope["url"] if scope else url


async def resolve_permalink(url: str, *, timeout: float = 8.0) -> str:
    """`url` with a share-sheet redirect followed to the post it really names.

    A share wrapper is a URL the page has never heard of. `facebook.com/share/p/
    <code>` names a post but appears nowhere inside it, so scoping from it finds
    no self-link, narrows to nothing, and the post is then read as the feed
    wrapped around it. That is how a photo album became a video memo playing the
    song attached to it.

    `headless._landed_rescope` already retries from wherever the BROWSER landed,
    and that turns out to be the wrong place to ask: Meta answers a logged-out
    browser with a wall, so the browser never lands on the post at all. The
    plain HTTP redirect needs no session — `/share/p/<code>` 302s straight to
    `/<author>/posts/<pfbid>` for an anonymous HEAD — so following it BEFORE
    anything renders is what puts the render on a page whose own anchors the
    scope can match. The landed retry stays as the second line.

    Host-blind: any wrapper on any host resolves the same way. Returns `url`
    unchanged when nothing redirects, when the destination is not a post
    permalink either, or on any network failure — so every caller behaves
    exactly as it did before whenever this cannot help.
    """
    if not url or post_scope(url) is None:
        return url
    import httpx

    try:
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=True
        ) as client:
            resp = await client.head(url)
            landed = str(resp.url)
    except Exception:
        return url
    if not landed or landed.rstrip("/") == url.rstrip("/"):
        return url
    scope = post_scope(landed)
    return scope["url"] if scope else url
