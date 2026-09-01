"""Network-sniffing media capture — OpenMemo's own "video download helper".

A browser extension like Video DownloadHelper does not parse each site by hand.
It watches every network request the page makes (`webRequest`) and, when a media
URL flies by (a progressive `.mp4`, an HLS `.m3u8`, a DASH `.mpd`), it records the
real CDN URL together with the headers the browser used — then re-fetches the
bytes directly. That is why it can pull a Threads clip in under a second while
`yt-dlp` (no Threads extractor, generic single-stream downloader) crawls for over
a minute on the very same file.

This module is the local, host-agnostic equivalent. It loads the page in the
existing Playwright browser (`core/headless`), listens to every response, and
returns the best media URL it saw plus the `Referer`/`User-Agent` the browser
actually sent for it — so the caller can download it at full CDN speed with no
per-site code. Nothing here knows or cares that the page is Threads: it works for
any site whose media is a fetchable URL. Hosts where this beats yt-dlp are just
listed in `localize_media.SNIFF_FIRST_HOSTS`; every other host falls back to it
only when yt-dlp fails.
"""
import asyncio
from urllib.parse import urlparse
from typing import Optional

# Reuse the warm, stealthed Chromium and cookie jars from the headless module so
# there is exactly one browser and one anti-detection surface to maintain.
from backend.core.headless import (
    _ensure_browser,
    _STEALTH_JS,
    _BROWSER_UA,
    _LARGEST_IMAGE_JS,
    _load_cookies,
    _save_cookies,
    _dismiss_consent,
    _scope_post,
)

# A media response we are willing to download directly. Progressive containers
# are preferred (one fetch, instantly playable); manifests are captured too so
# the caller can hand them to ffmpeg/yt-dlp instead of dead-ending.
_PROGRESSIVE_EXTS = (".mp4", ".m4v", ".webm", ".mov")
_MANIFEST_EXTS = (".m3u8", ".mpd")

# Content-type prefixes/values that mark a response as fetchable media.
_MEDIA_CTYPES = ("video/", "audio/", "application/vnd.apple.mpegurl",
                 "application/x-mpegurl", "application/dash+xml")

# Junk we never want to pick as "the video": tracking pixels, sprite sheets,
# poster frames. Filtered by size + extension, not by host.
_MIN_PROGRESSIVE_BYTES = 200_000  # 200 KB — below this it is a preview/sprite

# After the video half of a DASH stream lands, keep listening this long for the
# audio half before returning. The two representations are separate responses
# and the audio one trails; returning the instant video arrives is what left
# every sniffed reel mute.
_AUDIO_GRACE_MS = 4000


def _path_ext(url: str) -> str:
    return urlparse(url).path.rsplit("/", 1)[-1].rsplit(".", 1)[-1].lower() if "." in url else ""


def _kind_for(url: str, ctype: str) -> Optional[str]:
    """Classify a response URL/Content-Type as 'progressive', 'manifest', or None."""
    path = urlparse(url).path.lower()
    ct = (ctype or "").split(";")[0].strip().lower()
    if path.endswith(_MANIFEST_EXTS) or ct in (
        "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/dash+xml"
    ):
        return "manifest"
    if path.endswith(_PROGRESSIVE_EXTS) or ct.startswith(("video/", "audio/")):
        return "progressive"
    return None


def _is_audio_ctype(ctype: str) -> bool:
    """True when a response announces itself as an audio-only stream.

    DASH splits a clip into separate video and audio representations, and the
    audio one is always the smaller file — so "largest media response wins"
    picks the video and throws the sound away. This is the cheap signal that
    tells the two apart before anything is downloaded; the caller still ffprobes
    what it fetched, because a host that mislabels its Content-Type must not be
    able to produce a silent memo."""
    return (ctype or "").split(";")[0].strip().lower().startswith("audio/")


# JS run in-page: pull every <video>'s current source + the poster, and kick
# autoplay so a lazily-loaded clip actually issues its media request. Host-blind.
#
# Plays UNMUTED first. A muted player is allowed to skip the audio
# representation of a DASH stream entirely — it will never be heard, so why
# fetch it — and then there is no sound on the wire for us to capture. The
# browser is launched with --autoplay-policy=no-user-gesture-required so this
# actually starts; the muted retry stays as the fallback for the case where it
# does not, since a silent capture still beats no capture.
_PLAY_AND_PROBE_JS = """() => {
  const out = { srcs: [], poster: '', scoped: false, count: 0, imgs: 0, textLen: 0 };
  // Only the post's own players. Unscoped this played EVERY video on the page,
  // scrolling each one into view to make it start - which on a permalink page
  // means the "Related posts" feed underneath. That is how a Threads photo
  // carousel was saved as a stranger's video clip.
  const root = document.querySelector('[data-om-scope]');
  out.scoped = !!root;
  const vids = Array.from((root || document).querySelectorAll('video'));
  out.count = vids.length;
  // Evidence that the scope really is the post, and not an empty wrapper the
  // walk happened to stop on. "No video in scope" only means "no video" when
  // the scope holds something; otherwise the unscoped behaviour is safer than
  // reporting a reel as having no media.
  if (root) {
    out.imgs = Array.from(root.querySelectorAll('img')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 120 && r.height >= 120;
    }).length;
    out.textLen = (root.innerText || '').trim().length;
  }
  for (const v of vids) {
    try { v.scrollIntoView({block: 'center'}); } catch (_) {}
    try {
      v.muted = false;
      v.volume = 1;
      const p = v.play();
      if (p && p.catch) p.catch(() => {
        try { v.muted = true; const q = v.play(); if (q && q.catch) q.catch(() => {}); } catch (_) {}
      });
    } catch (_) {
      try { v.muted = true; const q = v.play(); if (q && q.catch) q.catch(() => {}); } catch (_) {}
    }
    const s = v.currentSrc || v.src || '';
    if (s) out.srcs.push(s);
    if (!out.poster && v.poster) out.poster = v.poster;
    for (const src of v.querySelectorAll('source')) {
      if (src.src) out.srcs.push(src.src);
    }
  }
  return out;
}"""

_OG_MEDIA_JS = """() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute('content') || '') : '';
  };
  return {
    video: pick('meta[property="og:video"]')
        || pick('meta[property="og:video:url"]')
        || pick('meta[property="og:video:secure_url"]'),
    image: pick('meta[property="og:image"]')
        || pick('meta[property="og:image:secure_url"]')
        || pick('meta[name="twitter:image"]'),
  };
}"""


async def sniff_media(
    url: str,
    *,
    timeout_ms: int = 45000,
    settle_ms: int = 10000,
    want_image: bool = False,
    scope_permalink: str | None = None,
) -> Optional[dict]:
    """Load `url` in the stealth browser and return the best media it saw, or None.

    Result: {
      "media_url":   str|None,       # direct, fetchable URL (None = no video)
      "kind":        "progressive"|"manifest"|None,
      "referer":     str,            # exactly what the browser sent for it
      "user_agent":  str,
      "content_type": str,
      "thumbnail_url": str|None,     # og:image / <video> poster, for the card
      "main_image":  str|None,       # largest rendered still (want_image only)
      "candidates":  [ {url, kind, referer, content_type, size, audio_only} ],
    }

    `candidates` is EVERY media response seen, largest first. `media_url` is
    only the best video pick out of it — on a DASH host the audio lives in a
    second entry, and the download step muxes the pair back into one file.

    Picks the largest progressive container seen on the network (the actual
    video file), falling back to a captured manifest, then to og:video — all
    host-agnostic. Returns None when the browser is unavailable or no media
    surfaced, so the caller can degrade to yt-dlp.

    `want_image=True` also reads the largest rendered still, and makes the call
    answer with `media_url=None` instead of None when the page turned out to
    carry no video at all. That is what lets ONE page load answer both "is this
    a video?" and "if not, what is the picture?" — the Instagram resolver needs
    exactly that, and paying for two browser passes to learn it is wasteful.
    Callers that only want a download keep guarding on `media_url`.

    `scope_permalink` restricts the capture to the post that permalink names.
    A permalink page is one post inside a feed of other posts, and "the biggest
    media response on the wire" cheerfully answers with a NEIGHBOUR's clip - a
    six-photo Threads carousel came back as somebody else's video that way. With
    a scope in hand, a post holding no player of its own answers `media_url=None`
    rather than handing over whatever else the page happened to load.
    """
    domain = urlparse(url).netloc.lstrip("www.")
    page_origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}/"

    browser = await _ensure_browser()
    if browser is None:
        return None

    # url -> {"kind","referer","content_type","size"} for every media response.
    seen: dict[str, dict] = {}

    ctx = None
    try:
        ctx = await browser.new_context(
            user_agent=_BROWSER_UA,
            viewport={"width": 1280, "height": 800},
            locale="en-US",
            timezone_id="America/New_York",
        )
        await ctx.add_init_script(_STEALTH_JS)

        saved = _load_cookies(domain)
        if saved:
            try:
                await ctx.add_cookies(saved)
            except Exception:
                pass

        page = await ctx.new_page()

        def _on_response(resp):
            try:
                kind = _kind_for(resp.url, resp.headers.get("content-type", ""))
                if not kind:
                    return
                req_headers = resp.request.headers
                try:
                    size = int(resp.headers.get("content-length") or 0)
                except (TypeError, ValueError):
                    size = 0
                prev = seen.get(resp.url)
                if prev and prev.get("size", 0) >= size:
                    return
                seen[resp.url] = {
                    "kind": kind,
                    # The Referer the BROWSER used for this exact request — the
                    # piece yt-dlp/curl get wrong by default. Host-agnostic.
                    "referer": req_headers.get("referer") or page_origin,
                    "content_type": resp.headers.get("content-type", ""),
                    "size": size,
                }
            except Exception:
                pass

        page.on("response", _on_response)

        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

        # A cookie gate is served instead of the page; decline it before looking
        # for a player, or the only thing on the wire is Meta's policy screen.
        await _dismiss_consent(page)

        # Narrow to the post itself. Everything after this - which players get
        # played, which still is "the" image - then belongs to THIS post.
        scoped = False
        if scope_permalink:
            await page.wait_for_timeout(1500)
            scoped = await _scope_post(page, scope_permalink)

        # Nudge a lazily-mounted player into requesting its media.
        try:
            await page.wait_for_selector("video", timeout=8000)
        except Exception:
            pass
        probe = {}
        try:
            probe = await page.evaluate(_PLAY_AND_PROBE_JS) or {}
        except Exception:
            probe = {}

        # The post is scoped, it holds real content, and none of that content is
        # a player. Everything the network still delivers belongs to a
        # neighbouring post, so there is nothing here to download — say so
        # instead of grabbing the biggest stranger. A scope that came back empty
        # is not trusted for this: falling through to the old, unscoped pick is
        # far better than telling a caller a reel has no video.
        scope_has_content = bool(probe.get("imgs") or probe.get("textLen"))
        if scoped and scope_has_content and not probe.get("count"):
            print(f"[sniff_media] {url} carries no video of its own")
            main_image = None
            if want_image:
                try:
                    main_image = await page.evaluate(_LARGEST_IMAGE_JS)
                except Exception:
                    main_image = None
            try:
                og_only = await page.evaluate(_OG_MEDIA_JS) or {}
            except Exception:
                og_only = {}
            return {
                "media_url": None,
                "kind": None,
                "referer": page_origin,
                "user_agent": _BROWSER_UA,
                "content_type": "",
                "thumbnail_url": og_only.get("image") or None,
                "main_image": main_image,
                "candidates": [],
            }

        # Let media requests fire. Break early once a real progressive file
        # lands — but on a DASH host the video and the audio representation are
        # separate responses that do NOT arrive together, so once video is in
        # hand keep listening for a short grace window instead of returning
        # immediately with half the clip. Bailing at the first big response is
        # what cost every sniffed reel its sound.
        deadline = settle_ms
        step = 500
        grace_left = _AUDIO_GRACE_MS
        while deadline > 0:
            await page.wait_for_timeout(step)
            deadline -= step
            have_media = any(
                v["kind"] == "progressive" and v["size"] >= _MIN_PROGRESSIVE_BYTES
                for v in seen.values()
            )
            if not have_media:
                continue
            if any(
                v["kind"] == "progressive" and _is_audio_ctype(v["content_type"])
                for v in seen.values()
            ):
                break  # both halves captured — nothing left to wait for
            grace_left -= step
            if grace_left <= 0:
                break

        og = {}
        try:
            og = await page.evaluate(_OG_MEDIA_JS) or {}
        except Exception:
            og = {}

        main_image = None
        if want_image:
            try:
                main_image = await page.evaluate(_LARGEST_IMAGE_JS)
            except Exception:
                main_image = None

        try:
            cookies = await ctx.cookies()
            if cookies:
                _save_cookies(domain, cookies)
        except Exception:
            pass

        thumbnail_url = og.get("image") or None

        # Every media response we saw, largest first, each with the Referer the
        # browser used for it. The caller needs the WHOLE list, not just the
        # winner: on a DASH host the sound is a second entry in here, and the
        # download step pairs them back together.
        candidates = [
            {
                "url": u,
                "kind": v["kind"],
                "referer": v["referer"],
                "content_type": v["content_type"],
                "size": v["size"],
                "audio_only": v["kind"] == "progressive" and _is_audio_ctype(v["content_type"]),
            }
            for u, v in sorted(seen.items(), key=lambda kv: kv[1]["size"], reverse=True)
        ]

        def _result(media_url, kind, referer, content_type):
            return {
                "media_url": media_url,
                "kind": kind,
                "referer": referer,
                "user_agent": _BROWSER_UA,
                "content_type": content_type,
                "thumbnail_url": thumbnail_url,
                "main_image": main_image,
                "candidates": candidates,
            }

        # 1) Largest progressive container on the wire — the real video file.
        # Audio-only responses are excluded from this pick: a DASH audio track
        # can outweigh a short video representation, and picking it would file a
        # soundtrack as the video. It stays in `candidates` for the mux step.
        progressive = [
            (u, v) for u, v in seen.items()
            if v["kind"] == "progressive" and not _is_audio_ctype(v["content_type"])
        ]
        if progressive:
            best_url, best = max(progressive, key=lambda kv: kv[1]["size"])
            return _result(best_url, "progressive", best["referer"], best["content_type"])

        # 2) A manifest (HLS/DASH) — hand back so caller can mux it. Preferred
        # over a lone audio response: ffmpeg pulls BOTH streams out of a
        # manifest, which is the complete clip rather than half of one.
        manifests = [(u, v) for u, v in seen.items() if v["kind"] == "manifest"]
        if manifests:
            best_url, best = manifests[0]
            return _result(best_url, "manifest", best["referer"], best["content_type"])

        # 3) og:video as a last resort (some hosts expose the mp4 in meta only).
        if og.get("video"):
            vid = og["video"]
            kind = "manifest" if vid.lower().split("?")[0].endswith(_MANIFEST_EXTS) else "progressive"
            return _result(vid, kind, page_origin, "")

        # 4) No video anywhere. A download caller gets None (nothing to fetch);
        # a want_image caller gets the verdict it asked for — "not a video, and
        # here is the still" — which is a real answer, not a failure.
        if want_image and (main_image or thumbnail_url):
            return _result(None, None, page_origin, "")

        return None

    except Exception as e:
        print(f"[sniff_media] failed for {url}: {e}")
        return None
    finally:
        if ctx is not None:
            try:
                await ctx.close()
            except Exception:
                pass
