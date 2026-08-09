"""Instagram media resolver — the guest media-info API, with a cookie fallback.

Why this exists: the page `instagram.com/p/<shortcode>/` now returns an empty
login shell (zero OpenGraph tags) to logged-out visitors, so the old og:image
scrape is dead. Public Instagram downloaders don't log in with accounts for
public posts — they call Instagram's INTERNAL guest API and read structured
JSON. This module does the same:

    GET https://www.instagram.com/api/v1/media/{media_id}/info/
        headers: X-IG-App-ID: 936619743392459  (the public web app id)
                 X-CSRFToken, X-ASBD-ID, X-IG-WWW-Claim, Referer

`media_id` is the base64 decode of the `/p/<shortcode>/` slug. The response's
`items[0].carousel_media[]` is EVERY slide of a carousel — full-res, ordered,
per-slide photo/video — which is exactly what we need to build a gallery.

Tiers (cheapest first — see extractor._instagram_resolve):
  1. guest API, no cookies      — works when the caller's IP is "warm"
  2. guest API + cookie jar     — a logged-in session is trusted from a flagged
     IP too, so this is the robust fallback (yt_cookies.txt, ADR-012 + in-app
     Instagram login).
The guest endpoint answers `{"require_login": true, ...}` / a rate-limit body
when the IP is throttled; we treat any non-usable response as None so the
caller falls to the next tier. Never raises.
"""
from __future__ import annotations

import http.cookiejar
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

# Public Instagram web app id — the header that flips the endpoint from "serve
# the HTML shell" to "serve the media JSON". Stable, public, not a secret.
_APP_ID = "936619743392459"
_ASBD_ID = "129477"

# Base64 alphabet Instagram uses to encode the numeric media id into the
# shortcode slug. Order matters — this is the exact table.
_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

# /p/, /reel(s)/, /tv/ — the four post-permalink shapes. Captures the shortcode.
_SHORTCODE_RE = re.compile(r"instagram\.com/(?:[^/]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", re.I)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def extract_shortcode(url: str) -> str | None:
    """The `/p/<shortcode>/` (or reel/tv) slug of an Instagram URL, else None."""
    m = _SHORTCODE_RE.search(url or "")
    return m.group(1) if m else None


def shortcode_to_media_id(shortcode: str) -> int | None:
    """Decode an Instagram shortcode to its numeric media id (base64). None on
    any stray character so a malformed slug degrades instead of raising."""
    n = 0
    for ch in shortcode:
        idx = _ALPHABET.find(ch)
        if idx < 0:
            return None
        n = n * 64 + idx
    return n


def _load_cookie_jar(cookies_path: Path | None) -> httpx.Cookies | None:
    """Load a Netscape cookies.txt into an httpx cookie container, or None.

    The same jar every other tier reads (yt-dlp/gallery-dl). A malformed or
    absent file is not an error here — it just means "no session", so we fall
    back to the anonymous guest path."""
    if not cookies_path:
        return None
    try:
        p = Path(cookies_path)
        if not p.is_file() or p.stat().st_size == 0:
            return None
        jar = http.cookiejar.MozillaCookieJar(str(p))
        jar.load(ignore_discard=True, ignore_expires=True)
        return httpx.Cookies(jar)
    except Exception:
        return None


def _best_image(item: dict) -> str | None:
    """Largest still from an item's image_versions2 candidates (index 0 is the
    biggest Instagram serves). Works for a photo item OR a video item's poster."""
    try:
        cands = ((item.get("image_versions2") or {}).get("candidates")) or []
        for c in cands:
            u = c.get("url")
            if u:
                return u
    except Exception:
        pass
    # Sidecar/older shapes sometimes carry a flat display_url.
    return item.get("display_url") or None


def _best_video(item: dict) -> str | None:
    """Highest-resolution PROGRESSIVE URL from an item's video_versions.

    This is the single most important field in the whole module for sound.
    `video_versions[]` are Instagram's progressive MP4 renditions — one file,
    video and audio already muxed. Every other tier ends up at Instagram's DASH
    manifest, where the video and the audio are separate representations, and
    grabbing "the biggest media response on the wire" gets the video-only one.
    That is why reels kept landing silent.

    Ordered by pixel count rather than trusting array order: the list is keyed
    by a `type` code whose ordering is not guaranteed, and picking [0] blindly
    can hand back a 480p rendition when a 1080p one is sitting right there.
    """
    best, best_px = None, -1
    try:
        for v in (item.get("video_versions") or []):
            u = v.get("url")
            if not u:
                continue
            try:
                px = int(v.get("width") or 0) * int(v.get("height") or 0)
            except (TypeError, ValueError):
                px = 0
            if px > best_px:
                best, best_px = u, px
    except Exception:
        return best
    return best


def _item_to_slide(item: dict) -> dict | None:
    """One carousel slide → {"url": display_image, "type": "image"|"video"}.

    `url` is always a still (the photo, or a video slide's poster) so the memo
    card and the carousel can render every slide as an image without a player.
    A video slide also carries `video_url` for a future inline-play upgrade."""
    img = _best_image(item)
    if not img:
        return None
    # media_type: 1 = image, 2 = video, 8 = carousel (handled a level up).
    is_video = item.get("media_type") == 2 or bool(item.get("video_versions"))
    slide = {"url": img, "type": "video" if is_video else "image"}
    if is_video:
        vurl = _best_video(item)
        if vurl:
            slide["video_url"] = vurl
    return slide


def _caption_text(item: dict) -> str:
    cap = item.get("caption")
    if isinstance(cap, dict):
        return (cap.get("text") or "").strip()
    if isinstance(cap, str):
        return cap.strip()
    return ""


def _normalize(item: dict) -> dict | None:
    """Turn a media-info `items[0]` into openMemo's normalized resolution dict.

    Shapes:
      carousel (media_type 8) → {"media_type": "carousel", "gallery": [slides…]}
      single photo (1)        → {"media_type": "image"}
      single video (2)        → {"media_type": "video", "video_url": …}
    Common fields: title, caption, username, thumbnail (first still)."""
    if not isinstance(item, dict):
        return None
    caption = _caption_text(item)
    username = ((item.get("user") or {}).get("username")) or ""
    base = {
        "caption": caption,
        "username": username,
        # A caption's first line is the memo title; fall back to the handle.
        "title": (caption.splitlines()[0].strip() if caption else "") or (
            f"@{username}" if username else "Instagram"
        ),
    }

    carousel = item.get("carousel_media")
    if isinstance(carousel, list) and carousel:
        slides = [s for s in (_item_to_slide(c) for c in carousel) if s]
        if not slides:
            return None
        base.update({
            "media_type": "carousel",
            "gallery": slides,
            "thumbnail": slides[0]["url"],
        })
        return base

    slide = _item_to_slide(item)
    if not slide:
        return None
    if slide["type"] == "video":
        base.update({
            "media_type": "video",
            "thumbnail": slide["url"],
            "video_url": slide.get("video_url"),
        })
    else:
        base.update({"media_type": "image", "thumbnail": slide["url"]})
    return base


async def fetch_media_info(url: str, *, cookies_path: Path | None = None) -> dict | None:
    """Resolve an Instagram post via the guest media-info API. None on any
    failure (bad URL, throttle/`require_login`, non-JSON, parse surprise) so the
    caller falls to the next resolver tier. Never raises.

    Pass `cookies_path` (the yt_cookies.txt jar) to send a logged-in session —
    the robust path when the caller's IP is rate-limited."""
    shortcode = extract_shortcode(url)
    if not shortcode:
        return None
    media_id = shortcode_to_media_id(shortcode)
    if media_id is None:
        return None

    cookies = _load_cookie_jar(cookies_path)
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=20.0,
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            cookies=cookies,
        ) as client:
            # Prime an anonymous guest session for the csrftoken when we don't
            # already have one from the jar — the API wants X-CSRFToken.
            csrf = None
            if cookies is not None:
                csrf = cookies.get("csrftoken", domain=".instagram.com") or cookies.get("csrftoken")
            if not csrf:
                try:
                    await client.get("https://www.instagram.com/")
                    csrf = client.cookies.get("csrftoken")
                except Exception:
                    csrf = None

            headers = {
                "X-IG-App-ID": _APP_ID,
                "X-ASBD-ID": _ASBD_ID,
                "X-IG-WWW-Claim": "0",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"https://www.instagram.com/p/{shortcode}/",
                "Accept": "*/*",
            }
            if csrf:
                headers["X-CSRFToken"] = csrf

            resp = await client.get(
                f"https://www.instagram.com/api/v1/media/{media_id}/info/",
                headers=headers,
            )
            ctype = resp.headers.get("content-type", "")
            if resp.status_code != 200 or "json" not in ctype:
                # The HTML shell or a redirect — IP not trusted for the guest API.
                return None
            data = resp.json()
    except Exception as e:
        log.info("instagram media-info failed for %s: %r", shortcode, e)
        return None

    if not isinstance(data, dict) or data.get("require_login"):
        return None
    items = data.get("items")
    if not isinstance(items, list) or not items:
        return None
    resolved = _normalize(items[0])
    if resolved is not None:
        resolved["shortcode"] = shortcode
        log.info(
            "instagram media-info ok (%s, %s%s)",
            shortcode, resolved.get("media_type"),
            f", {len(resolved.get('gallery') or [])} slides" if resolved.get("gallery") else "",
        )
    return resolved
