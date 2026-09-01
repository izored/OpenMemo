"""Threads media resolver — a permalink resolved to the post, not to the page.

Why this exists. Threads has no yt-dlp extractor, so every threads.com URL used
to fall to the generic "video host" path: `_minimal_link` scraped whatever the
headless browser rendered, the memo was stamped `video` because the DOMAIN is on
the video list, and the download helper then pulled the largest clip anywhere on
the page. Three separate wrong answers stack up on a photo post, and a live
six-photo carousel (threads.com/@medallomami_/post/Dcq6Ff4DHeR, 2026-09-01)
produced all three at once:

  * saved as `video`, from the domain alone, with no video anywhere on the page
  * the downloaded mp4 belonged to a stranger's post in the "Related threads"
    feed underneath, because the sniffer plays every player it can see
  * `content_text` was Meta's cookie-consent screen, because that is what a cold
    browser profile is served instead of the post

The fix is scoping, not per-site parsing. `headless.render_page(scope_permalink=)`
tags the post's own subtree before any reader runs, so the slides, the picture
and the text all come from THIS post. What is left for this module is the small
amount of Threads-shaped knowledge that cannot be derived: where the caption
lives (OpenGraph, served to a link-preview crawler with no login wall), and that
a `/share/<code>/` link is a redirect to a real permalink.

Tiers, cheapest first:
  1. crawler-UA OpenGraph — title, caption, canonical permalink. No login wall.
  2. scoped headless render — the ordered carousel, and whether the post owns a
     player of its own.
Neither tier raises; a total failure returns a plain link card so a save never
dead-ends.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse, urlunparse

log = logging.getLogger(__name__)

_HOSTS = ("threads.com", "threads.net")

# /@user/post/<code> — the permalink shape. /share/<code>/ is a redirect to one.
_PERMALINK_RE = re.compile(r"/@[^/]+/post/[A-Za-z0-9_-]+", re.I)

# Which tier answered. Mirrors the Instagram ladder so Settings can see a host
# quietly degrade (plan 026).
THREADS_TIER_SCOPED = "threads:browser-scope"
THREADS_TIER_OG = "threads:opengraph"
THREADS_TIER_BLOCKED = "threads:blocked"

THREADS_TIERS = (THREADS_TIER_SCOPED, THREADS_TIER_OG, THREADS_TIER_BLOCKED)


def is_threads_url(url: str) -> bool:
    """True when this URL belongs to Threads."""
    try:
        host = urlparse(url or "").netloc.lower()
    except Exception:
        return False
    return any(h in host for h in _HOSTS)


def canonical_permalink(url: str, og_url: str = "") -> str:
    """The `/@user/post/<code>` permalink for a Threads URL, query stripped.

    A share-sheet link (`/share/<code>/`) carries no author and no post code, so
    the scope pass has nothing to match against — `og:url` from the crawler
    fetch is what turns it back into a permalink. Falls back to the URL as given
    (minus its tracking query) when there is no better answer."""
    for candidate in (og_url, url):
        if not candidate:
            continue
        try:
            parts = urlparse(candidate)
        except Exception:
            continue
        if _PERMALINK_RE.search(parts.path or ""):
            return urlunparse(parts._replace(query="", fragment=""))
    try:
        parts = urlparse(url)
        return urlunparse(parts._replace(query="", fragment=""))
    except Exception:
        return url


def classify(post_media: list, og_video: str) -> str:
    """The memo type for a Threads post, from what the POST actually holds.

    `post_media` is the scoped render's answer, so it is authoritative: a clip
    inside the post makes it a video, stills make it an image, and a post with
    no media of its own is a link — a text post, which is most of Threads.
    The domain is never a signal here; treating "threads.com" as proof of video
    is the bug this module exists to remove."""
    if any((m or {}).get("type") == "video" for m in post_media or []):
        return "video"
    if post_media:
        return "image"
    return "video" if og_video else "link"


def _slides(post_media: list) -> list | None:
    """The gallery for a multi-item post, or None for a single item.

    Mirrors the Instagram sidecar shape ({url, type}) so the memo page and the
    lightbox render a Threads carousel with no viewer changes. An all-video post
    keeps no gallery: expiring CDN mp4 URLs are not renderable slides — the same
    rule `_instagram_resolve` applies to a sidecar of reels."""
    items = [m for m in (post_media or []) if (m or {}).get("url")]
    if len(items) < 2:
        return None
    if all(m.get("type") == "video" for m in items):
        return None
    return [{"url": m["url"], "type": m.get("type") or "image"} for m in items]


def _cover(post_media: list) -> str:
    """The card image: the first slide, or a video's poster frame."""
    if not post_media:
        return ""
    first = post_media[0]
    if first.get("type") == "video":
        return first.get("poster") or first.get("url") or ""
    return first.get("url") or ""


async def resolve_threads(url: str, domain: str, fav: str | None = None) -> dict:
    """Resolve a Threads permalink to a memo dict. Never raises."""
    from backend.core.extractor import _CRAWLER_UA, _fetch_og_meta

    # Tier 1 — OpenGraph via the link-preview crawler UA. Meta serves these tags
    # with no login wall and no consent gate, which makes it the only reliable
    # source for the caption and the canonical permalink.
    try:
        og = await _fetch_og_meta(url, user_agent=_CRAWLER_UA) or {}
    except Exception:
        og = {}

    permalink = canonical_permalink(url, og.get("og_url") or "")
    title = (og.get("title") or "").strip()
    caption = (og.get("description") or "").strip()
    og_video = (og.get("video_url") or "").strip()

    base = {
        "title": title or permalink,
        "description": caption,
        "content_text": caption,
        "content_raw": "",
        "source_url": permalink,
        "source_domain": domain,
        "source_favicon": fav,
        "thumbnail_path": "",
        "type": "link",
        "resolve_tier": THREADS_TIER_OG if title or caption else THREADS_TIER_BLOCKED,
    }

    # Tier 2 — the scoped render. This is the tier that knows the post has six
    # photos rather than one, and that the clip further down the page belongs to
    # somebody else.
    post_media: list = []
    try:
        from backend.core.headless import render_page

        rendered = await render_page(
            permalink, want_main_image=True, scope_permalink=permalink
        ) or {}
        post_media = rendered.get("post_media") or []
        if rendered.get("consent_wall") and not post_media:
            # The gate outlasted the decline click. The OpenGraph tags above are
            # still real, so the memo keeps its title and caption — what must
            # never happen is the cookie policy becoming the body.
            log.info("threads: consent gate blocked the render for %s", permalink)
        if post_media:
            base["resolve_tier"] = THREADS_TIER_SCOPED
            base["thumbnail_path"] = _cover(post_media)
            gallery = _slides(post_media)
            if gallery:
                base["gallery"] = gallery
        elif rendered.get("main_image"):
            base["thumbnail_path"] = rendered["main_image"]
    except Exception as e:
        log.info("threads: scoped render failed for %s: %s", permalink, e)

    base["type"] = classify(post_media, og_video)

    # og:image on Threads is a GENERATED link-preview card — a 1200x628
    # composite with the author's name burnt into it, not the post's picture.
    # Worth having only when the render found nothing, and never on a text post,
    # where it would hang a fake photo on what is really a quote.
    if not base["thumbnail_path"] and base["type"] != "link":
        base["thumbnail_path"] = og.get("thumbnail_path") or ""

    return base
