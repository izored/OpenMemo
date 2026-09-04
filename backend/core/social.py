"""What a scoped social post holds, turned into a memo's shape.

`core/permalinks` says which URLs name one post. `headless.render_page` reads
that post's own subtree. This is the small layer between them and the memo: the
rules for typing a post by its contents, building its gallery, and picking its
cover.

It exists because those rules are not Threads rules. Threads, Reddit, X, TikTok
and Bluesky all put a post on a page full of other posts, and all of them used
to be typed from the DOMAIN — every reddit.com URL was a video because
reddit.com is on the video-host list, whether the post was a clip, a photo set
or three sentences of text. The domain is not evidence. What the post holds is.

Per ADR "scope is the memo type, not the one provider": one abstraction, every
network, no per-host branches at the call sites.
"""
from __future__ import annotations


def classify_media(
    post_media: list,
    *,
    og_video: str = "",
    scoped: bool = False,
    post_text: str = "",
    fallback: str = "video",
) -> str:
    """The memo type for a post, from what the post actually holds.

    Order of evidence, strongest first: a post that is ONLY players, stills
    inside the post, an `og:video` the render could not reach, then a scope that
    found real text and no media at all, which is a text post.

    A mixed post is an image post. This is the rule the Instagram path already
    applies -- `all_video = bool(slides) and not stills`, "a mixed post keeps its
    gallery: the stills carry it" -- and the reason it has to be shared is that
    the alternative, one clip outranking any number of photos, files an album of
    three photos and a clip as a video. Nothing then renders it: both gallery
    branches on the memo page ask for an image memo, so the slides are
    downloaded, stored, served and shown by nobody, behind a video player with
    no video to play.

    `fallback` is what to answer when NONE of that is known, and it is the whole
    safety story here. A caller that could not scope the page has learned
    nothing, so it keeps whatever it would have said before (`video` on a video
    host); a caller whose own tier already confirmed the post exists can pass
    `link` and let a text post be a text post."""
    stills = [m for m in post_media or [] if (m or {}).get("type") != "video"]
    if post_media and not stills:
        return "video"
    if stills:
        return "image"
    if og_video:
        return "video"
    if scoped and (post_text or "").strip():
        return "link"
    return fallback


def slides(post_media: list) -> list | None:
    """The gallery for a multi-item post, or None for a single item.

    Mirrors the Instagram sidecar shape ({url, type}) so a carousel from any
    network renders in the memo page and the lightbox with no viewer changes.
    An all-video post keeps no gallery: expiring CDN mp4 URLs are not renderable
    slides, which is the rule `_instagram_resolve` already applies to a sidecar
    of reels."""
    items = [m for m in (post_media or []) if (m or {}).get("url")]
    if len(items) < 2:
        return None
    if all(m.get("type") == "video" for m in items):
        return None
    return [{"url": m["url"], "type": m.get("type") or "image"} for m in items]


def cover(post_media: list) -> str:
    """The card image: the first slide, or a video's poster frame.

    Walks past an item that names no picture at all. A player mounted but not
    yet loaded carries neither a src nor a poster, and letting that shadow the
    still sitting behind it leaves the card blank."""
    for item in post_media or []:
        item = item or {}
        if item.get("type") == "video":
            pic = item.get("poster") or item.get("url") or ""
        else:
            pic = item.get("url") or ""
        if pic:
            return pic
    return ""


def apply_media(memo: dict, post_media: list) -> dict:
    """Attach a scoped post's cover and gallery to a memo dict, in place.

    Only overwrites a cover the memo does not already have, so a resolver tier
    that found a better one keeps it."""
    if not post_media:
        return memo
    if not memo.get("thumbnail_path"):
        memo["thumbnail_path"] = cover(post_media)
    gallery = slides(post_media)
    if gallery:
        memo["gallery"] = gallery
    return memo
