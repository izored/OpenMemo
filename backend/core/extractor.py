"""Content extractors for URLs, PDFs, documents, images."""
import asyncio
import logging
import re
import json
import base64
from pathlib import Path
from urllib.parse import urlparse, urljoin, unquote

import httpx
from bs4 import BeautifulSoup
import html2text

from backend.core.ollama_client import ollama_client

log = logging.getLogger(__name__)


# --- Defuddle-style metadata extraction (ported from Obsidian Clipper) ---

# Elements that are never part of the main content.
_JUNK_TAGS = [
    "script", "style", "noscript", "iframe", "svg", "form", "button",
    "nav", "footer", "aside", "header",
]
_JUNK_SELECTORS = [
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-hidden="true"]', ".nav", ".navbar", ".menu", ".sidebar",
    ".footer", ".header", ".comments", ".comment", ".share", ".social",
    ".related", ".newsletter", ".cookie", ".ad", ".ads", ".advert",
    ".promo", ".popup", ".modal",
]


def _meta(soup: BeautifulSoup, key: str, val: str) -> str:
    """First matching <meta> content by name OR property, case-insensitive.

    `key` is kept for call-site readability; lookup checks both attributes
    like Defuddle's getMetaContent.
    """
    pat = re.compile(f"^{re.escape(val)}$", re.I)
    for attr in ("property", "name"):
        tag = soup.find("meta", attrs={attr: pat})
        if tag and tag.get("content"):
            return tag["content"].strip()
    return ""


def _extract_jsonld(soup: BeautifulSoup) -> list[dict]:
    """All schema.org JSON-LD objects on the page (flattened)."""
    out: list[dict] = []

    def _walk(obj):
        if isinstance(obj, dict):
            out.append(obj)
            for v in obj.values():
                _walk(v)
        elif isinstance(obj, list):
            for v in obj:
                _walk(v)

    for tag in soup.find_all("script", type="application/ld+json"):
        raw = tag.string or tag.get_text() or ""
        try:
            _walk(json.loads(raw))
        except Exception:
            continue
    return out


def _schema_image(jsonld: list[dict]) -> str:
    """schema.org image: string | {url} | [..] — first usable URL."""
    for obj in jsonld:
        img = obj.get("image") or obj.get("thumbnailUrl")
        if not img:
            continue
        if isinstance(img, str):
            return img
        if isinstance(img, dict) and img.get("url"):
            return img["url"]
        if isinstance(img, list) and img:
            first = img[0]
            if isinstance(first, str):
                return first
            if isinstance(first, dict) and first.get("url"):
                return first["url"]
    return ""


def _pick_image(soup: BeautifulSoup, jsonld: list[dict], base_url: str) -> str:
    """Defuddle image priority: og:image → twitter:image → schema → link → hero <img>."""
    candidates = [
        _meta(soup, "property", "og:image"),
        _meta(soup, "property", "og:image:url"),
        _meta(soup, "name", "twitter:image"),
        _meta(soup, "name", "twitter:image:src"),
        _schema_image(jsonld),
        _meta(soup, "name", "sailthru.image.full"),
    ]
    link_img = soup.find("link", rel=re.compile(r"image_src", re.I))
    if link_img and link_img.get("href"):
        candidates.append(link_img["href"])

    for c in candidates:
        if c and c.strip():
            return urljoin(base_url, c.strip())

    # Last resort: largest content <img> (skip icons/spacers/data URIs).
    root = soup.find("article") or soup.find("main") or soup.body or soup
    best = ""
    best_area = 0
    for img in root.find_all("img"):
        src = img.get("src") or img.get("data-src") or ""
        if not src or src.startswith("data:"):
            continue
        try:
            area = int(img.get("width", 0)) * int(img.get("height", 0))
        except (TypeError, ValueError):
            area = 0
        if area >= best_area:
            best_area = area
            best = src
    if best:
        return urljoin(base_url, best)
    return ""


def _clean_content_node(soup: BeautifulSoup):
    """Find the main content root and strip junk in-place. Returns the node."""
    root = (
        soup.find("article")
        or soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.body
        or soup
    )
    for tag in root.find_all(_JUNK_TAGS):
        tag.decompose()
    for sel in _JUNK_SELECTORS:
        for el in root.select(sel):
            el.decompose()
    return root


def _parse_html(html: str, base_url: str, url: str, domain: str) -> dict | None:
    """Parse fetched/rendered HTML into a memo dict (Defuddle-style: OpenGraph +
    JSON-LD + readable content -> Markdown). Returns None when the page yields
    nothing usable (no title, image, or content) so the caller can escalate."""
    soup = BeautifulSoup(html, "lxml")
    jsonld = _extract_jsonld(soup)

    title = (
        _meta(soup, "property", "og:title")
        or next((o["headline"] for o in jsonld if isinstance(o.get("headline"), str)), "")
        or (soup.title.string.strip() if soup.title and soup.title.string else "")
    )
    description = (
        _meta(soup, "name", "description")
        or _meta(soup, "property", "og:description")
        or _meta(soup, "name", "twitter:description")
        or next((o["description"] for o in jsonld if isinstance(o.get("description"), str)), "")
    )
    thumbnail = _pick_image(soup, jsonld, base_url)
    favicon = f"https://www.google.com/s2/favicons?domain={domain}&sz=32"

    root = _clean_content_node(soup)
    for img in root.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if src and not src.startswith("data:"):
            img["src"] = urljoin(base_url, src)
        elif not src:
            img.decompose()
    for a in root.find_all("a", href=True):
        a["href"] = urljoin(base_url, a["href"])

    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.body_width = 0
    content_text = h.handle(str(root))
    content_text = re.sub(r"\n{3,}", "\n\n", content_text).strip()

    # Nothing usable -> let the caller try the headless path or a minimal card.
    if not title.strip() and not thumbnail and not content_text.strip():
        return None

    return {
        "title": title.strip(),
        "description": description.strip(),
        "content_text": content_text,
        # Markdown (not raw HTML) -- MemoDetail renders this via ReactMarkdown.
        "content_raw": content_text,
        "source_url": url,
        "source_domain": domain,
        "source_favicon": favicon,
        "thumbnail_path": thumbnail,
        # Saved web pages are filed as "link" (a webpage IS a link).
        "type": "link",
    }


# Content-types that map to a non-media memo type (image/audio/video are handled
# by their MIME prefix). Extends the extension-based path for extensionless URLs.
_CTYPE_CAT = {"application/pdf": "document"}


def _direct_media_memo(url: str, domain: str, ctype: str | None = None) -> dict | None:
    """Build a memo dict for a URL that points straight at a file, else None.

    A direct file link (https://site/photo.jpg, /track.mp3, /paper.pdf) is NOT a
    web page; scraping it as HTML yields a blank card (no OG tags, no readable
    body). Detect it by path extension first (no network), then by an
    already-fetched Content-Type (covers extensionless URLs). An image renders
    immediately via thumbnail_path (the remote URL, cached locally afterwards);
    audio/video/document keep source_url so the card files correctly and
    auto-download / "Make it local" can pull a playable copy (ADR-003/005)."""
    from backend.core.security.upload import categorize_extension

    path = urlparse(url).path
    cat: str | None = None
    ext = Path(path).suffix.lower()
    if ext:
        c = categorize_extension(ext)
        if c in ("image", "video", "audio", "document"):
            cat = c
    if cat is None and ctype:
        ct = ctype.split(";")[0].strip().lower()
        if ct in _CTYPE_CAT:
            cat = _CTYPE_CAT[ct]
        elif ct.startswith(("image/", "audio/", "video/")):
            cat = ct.split("/", 1)[0]
    if cat is None:
        return None

    name = unquote(Path(path).name) or domain
    return {
        "title": name,
        "description": "",
        "content_text": "",
        "source_url": url,
        "source_domain": domain,
        "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
        "thumbnail_path": url if cat == "image" else "",
        "type": cat,
    }


# Cloudflare challenge page titles / body markers that indicate the plain-HTTP
# response is an interstitial, not real content. When detected we escalate to
# the headless browser path instead of returning the challenge page as a memo.
_CF_TITLE_MARKERS = {
    "human verification",
    "just a moment",
    "attention required",
    "checking your browser",
    "please wait",
    "security check",
    "ddos protection",
    "one more step",
}
_CF_BODY_MARKERS = [
    "__cf_chl_opt",
    "cf-browser-verification",
    "cdn-cgi/challenge-platform",
    "cf-challenge-running",
    "cf-wrapper",
    "jschl-answer",
]


def _is_cf_challenge(parsed: dict | None, raw_html: str) -> bool:
    """Return True if the parsed result or raw HTML looks like a CF challenge."""
    if parsed is not None:
        title_lower = (parsed.get("title") or "").lower().strip()
        if title_lower in _CF_TITLE_MARKERS:
            return True
    return any(m in raw_html for m in _CF_BODY_MARKERS)


async def extract_url(url: str) -> dict:
    """Extract content from a URL (article, page).

    Plain HTTP fetch first (fast, covers most sites). If the response is a
    bot-challenge stub (non-200, e.g. Cloudflare 202), a 200 that renders to
    nothing (JS SPA / antibot wall), or a 200 that is a Cloudflare challenge
    interstitial (title "Human Verification" etc.), escalate to `_minimal_link`
    which drives a real headless browser past the challenge."""
    parsed_url = urlparse(url)
    domain = parsed_url.netloc.lstrip("www.")

    # Direct file link (…/photo.jpg, …/track.mp3, …/paper.pdf) — not a web page.
    # File it from the extension so it renders/files correctly instead of
    # scraping to a blank card. No network needed.
    direct = _direct_media_memo(url, domain)
    if direct is not None:
        return direct

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
    ) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            # Extensionless direct media (a CDN URL with no suffix) — catch it
            # from the Content-Type now that the response is in hand.
            direct = _direct_media_memo(url, domain, resp.headers.get("content-type"))
            if direct is not None:
                return direct
            # Only a real 200 carries real content; a 2xx-but-not-200 is a
            # challenge interstitial (Cloudflare managed challenge -> HTTP 202 +
            # JS stub). Route anything non-200, or a 200 that renders to nothing
            # OR to a CF challenge page, to the headless path.
            if resp.status_code == 200:
                parsed = _parse_html(resp.text, str(resp.url), url, domain)
                if parsed is not None and not _is_cf_challenge(parsed, resp.text):
                    return parsed
        except Exception:
            pass

    return await _minimal_link(url, domain)


async def extract_pdf(file_path: str) -> dict:
    """Extract text from PDF."""
    import asyncio
    from pypdf import PdfReader
    
    def _read_pdf():
        reader = PdfReader(file_path)
        pages_text = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text)
        return "\n\n".join(pages_text)
    
    content = await asyncio.to_thread(_read_pdf)
    filename = Path(file_path).stem
    
    return {
        "title": filename,
        "description": content[:200] if content else "",
        "content_text": content,
        "type": "document",
    }


async def extract_docx(file_path: str) -> dict:
    """Extract text from DOCX."""
    import asyncio
    from docx import Document
    
    def _read_docx():
        doc = Document(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    
    content = await asyncio.to_thread(_read_docx)
    filename = Path(file_path).stem
    
    return {
        "title": filename,
        "description": content[:200] if content else "",
        "content_text": content,
        "type": "document",
    }


async def extract_image(file_path: str) -> dict:
    """Extract description from image using vision model."""
    import asyncio
    
    def _read_image():
        with open(file_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    
    image_data = await asyncio.to_thread(_read_image)
    
    # Use vision model to describe
    try:
        caption = await ollama_client.vision(image_data)
    except Exception:
        caption = ""
    
    filename = Path(file_path).stem
    
    return {
        "title": filename,
        "description": caption[:200] if caption else "",
        "content_text": caption,
        "type": "image",
    }


# Domains where yt-dlp should be tried first before article scraping.
# yt-dlp supports 1000+ sites; this list just gates the fast path so we
# don't run yt-dlp on every article URL. Add domains here as needed.
_VIDEO_DOMAINS = (
    "youtube.com", "youtu.be",
    "vimeo.com",
    "dailymotion.com",
    "twitch.tv",
    "facebook.com", "fb.com", "fb.watch",
    "instagram.com",
    "tiktok.com",
    "twitter.com", "x.com",
    "threads.net", "threads.com",
    "reddit.com",
    "rumble.com",
    "odysee.com",
    "bitchute.com",
    "bilibili.com",
    "nicovideo.jp",
    "streamable.com",
    "streamja.com",
    "clips.twitch.tv",
    "medal.tv",
    "mixcloud.com",
    "soundcloud.com",
    "bandcamp.com",
    "pornhub.com",
)

# Audio-only hosts. These also live in _VIDEO_DOMAINS (yt-dlp pulls them like any
# site), but the item is AUDIO, not video. Centralized so classification +
# fallback never mistype them — a transient yt-dlp probe failure must not turn a
# SoundCloud track into a dead "video" memo (ADR-005, ADR-001). One source of
# truth, consumed by extract_video's fallback and classify.derive_memo_type.
_AUDIO_DOMAINS = (
    "soundcloud.com",
    "bandcamp.com",
    "mixcloud.com",
    "audius.co",
    "audiomack.com",
)


def is_audio_host(url: str) -> bool:
    """True when the URL is from a known audio-only platform (SoundCloud, etc.)."""
    try:
        domain = urlparse(url).netloc.lower()
    except Exception:
        return False
    return any(d in domain for d in _AUDIO_DOMAINS)


def detect_url_type(url: str) -> str:
    """Return 'video' if the URL is from a known video/media platform, else 'article'."""
    domain = urlparse(url).netloc.lower()
    if any(d in domain for d in _VIDEO_DOMAINS):
        return "video"
    return "article"


# Video hosts that have a reliable inline iframe player on the frontend (mirrors
# lib/platforms.ts). A video from one of these plays remotely in the embed, so we
# do NOT auto-download it (saves disk on big platforms like YouTube). A video
# WITHOUT an embed — Threads, Reddit, an unknown host — has no remote player, so
# it is auto-localized on save (sniff/yt-dlp) to become playable and survive the
# source being deleted. Single source of truth for the "should we auto-localize a
# video?" decision (ADR-001 — no per-host code at the call sites).
_EMBED_VIDEO_HOSTS = (
    "youtube.com", "youtu.be", "youtube-nocookie.com",
    "vimeo.com",
    "instagram.com",
    "tiktok.com",
    "twitter.com", "x.com",
    "facebook.com", "fb.com", "fb.watch",
    "dailymotion.com", "dai.ly",
    "streamable.com",
    "twitch.tv",
)


def has_embed_player(url: str) -> bool:
    """True when the URL's host has a reliable inline iframe player (YouTube,
    Vimeo, …). Mirrors the frontend platform registry. A video without an embed
    (Threads, Reddit, unknown host) is auto-localized on save instead."""
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return False
    return any(h in host for h in _EMBED_VIDEO_HOSTS)


# Paths that unambiguously mean "still photo" on an otherwise video-capable host.
# Lets a photo post (FB photo, TikTok photo mode, X/Twitter photo) be filed as an
# image instead of a video. Deliberately conservative — ambiguous paths (e.g.
# Instagram /p/, which can be photo OR video) are left out so a real video is
# never mislabeled a photo. yt-dlp still wins whenever it can pull an actual video.
_PHOTO_PATH_RE = re.compile(
    r"""
      facebook\.com/(?:photo\b|photo\.php|[^/]+/photos/)   # FB photo permalinks
    | tiktok\.com/@[^/]+/photo/                             # TikTok photo mode
    | (?:twitter|x)\.com/[^/]+/status/\d+/photo/           # X/Twitter photo view
    """,
    re.I | re.X,
)


def _url_media_hint(url: str) -> str | None:
    """Return 'image' when the URL path unambiguously points at a still photo on
    a video-capable host, else None. Centralizes photo-vs-video disambiguation so
    no classify/render site hardcodes per-host rules (ADR-001)."""
    return "image" if _PHOTO_PATH_RE.search(url or "") else None


async def extract_video(url: str) -> dict:
    """Extract metadata from any yt-dlp-supported video platform.

    Uses yt-dlp --dump-json universally — no per-site code. yt-dlp handles
    1000+ sites natively. Falls back to _minimal_link if yt-dlp fails.
    """
    import subprocess

    parsed = urlparse(url)
    domain = parsed.netloc.lstrip("www.")

    # Instagram resolves through the guest media-info API first (extractor tier
    # ladder in _instagram_resolve): yt-dlp login-walls every IG post now, and
    # only the media-info JSON carries the full carousel. Photo/carousel/video
    # all come back here; a total block returns a graceful needs-login link
    # instead of a dead video card.
    if "instagram.com" in domain:
        return await _instagram_resolve(url, domain)

    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-playlist",
             "--no-warnings", "--socket-timeout", "20", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip().splitlines()[0])
            title = data.get("title") or data.get("fulltitle") or ""
            description = data.get("description") or ""
            thumbnail = (
                data.get("thumbnail")
                or ((data.get("thumbnails") or [{}])[-1]).get("url", "")
            )
            uploader = data.get("uploader") or data.get("channel") or ""
            # Prepend uploader to description so it's searchable/contextual.
            video_desc = f"{uploader}\n\n{description}".strip() if uploader else description
            # vcodec "none" + no dimensions = audio-only (SoundCloud, Bandcamp, etc.)
            is_audio = data.get("vcodec") == "none" or (
                not data.get("width") and not data.get("height")
            )
            return {
                "title": title or url,
                "description": video_desc[:500],
                "content_text": video_desc,
                "video_description": video_desc,
                "source_url": url,
                "source_domain": domain,
                "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
                "thumbnail_path": thumbnail,
                "type": "audio" if is_audio else "video",
            }
    except Exception:
        pass

    # yt-dlp failed (private, login-required, unsupported, or a non-video item).
    # Instagram is handled earlier via _instagram_resolve and never reaches here.
    result = await _minimal_link(url, domain)
    # A photo post on a video host must not become a video memo. Downgrade to
    # image only when the URL path clearly says photo; an audio-only host stays
    # audio (SoundCloud/Bandcamp probe failures must not dead-end as "video" —
    # ADR-005); otherwise keep video (the item may be a private/region-locked
    # video we just couldn't pull).
    result["type"] = _url_media_hint(url) or ("audio" if is_audio_host(url) else "video")
    return result


_BROWSER_UA_HTML = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Link-preview crawler UA. Meta serves full OpenGraph tags (og:image with a
# signed CDN URL, og:title/og:description with author + caption) to link-preview
# bots with NO login wall — while a browser UA gets redirected to the login
# page. Verified against a live photo post 2026-07-24 (plan:
# instagram-telegram-capture Phase 0).
_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


# A leading engagement banner some networks bake into a caption, e.g.
# "417 reactions · 30 shares | Today is…". Stripped so the heading starts at the
# real first word. Requires the trailing "|" so a normal title is never touched.
_ENGAGEMENT_PREFIX = re.compile(
    r"^\s*\d[\d.,]*\s*[KMB]?\s*"
    r"(?:reactions?|likes?|views?|shares?|comments?|followers?)\b.*?\|\s*",
    re.I,
)


def concise_title(title: str, max_len: int = 100, target: int = 80) -> tuple[str, bool]:
    """Derive a heading-length title, returning (title, was_shortened).

    Some sources (Facebook, TikTok, a few YouTube/IG posts) have no title field,
    so yt-dlp / OpenGraph hand back the whole caption as the title — a memo can
    arrive with an 800-character "title". We keep the full text elsewhere (the
    memo's description / video_description) and only derive a short heading here:
    drop any engagement banner, take the first sentence, then hard-cut at a word
    boundary. Titles at or under `max_len` pass through untouched, so a normal
    title is never altered."""
    t = (title or "").strip()
    if len(t) <= max_len:
        return t, False
    # Drop a leading "417 reactions · 30 shares |" banner, keep the caption.
    t = (_ENGAGEMENT_PREFIX.sub("", t).strip() or (title or "").strip())
    # First line, then first sentence, if that already gives a clean heading.
    t = t.splitlines()[0].strip()
    m = re.match(r"(.+?[.!?])(?:\s|$)", t)
    if m and 20 <= len(m.group(1)) <= max_len:
        return m.group(1).strip(), True
    if len(t) <= max_len:
        return t, True
    # Still long → cut at the last word boundary near `target`, drop trailing
    # punctuation, add an ellipsis.
    piece = t[:target]
    sp = piece.rfind(" ")
    cut = piece[:sp] if sp > target * 0.6 else piece
    cut = re.sub(r"[\s.,;:!?|–—-]+$", "", cut)
    return cut + "…", True


def canonical_source_url(url: str) -> str:
    """Strip query + fragment from an Instagram URL so share-sheet tracking
    params (?igsh=…, ?utm_…) never make the same post look like two different
    sources. Non-Instagram URLs pass through untouched — query strings can be
    load-bearing elsewhere (e.g. youtube.com/watch?v=)."""
    try:
        parsed = urlparse(url)
        if "instagram.com" in parsed.netloc.lower():
            return parsed._replace(query="", fragment="").geturl()
    except Exception:
        pass
    return url


def _is_instagram_video_path(url: str) -> bool:
    """True when the URL path itself says video (/reel/, /reels/, /tv/).
    Needed because Instagram's crawler page for a reel does NOT reliably carry
    og:video — verified live 2026-07-24, a reel came back with og:image only —
    so the og:video guard alone would misfile reels as photos."""
    try:
        path = urlparse(url).path.lower()
    except Exception:
        return False
    return any(seg in path for seg in ("/reel/", "/reels/", "/tv/"))


def _parse_gallery_dl_dump(text: str) -> tuple[list[str], str] | None:
    """ALL full-size image URLs + caption out of `gallery-dl -j` output.

    The dump is a JSON array of [type, ...] entries; type 3 = a downloadable
    URL with its metadata dict (description holds the caption). A carousel yields
    one type-3 entry PER slide, so we collect them all (ordered) instead of just
    the first — that is what makes the whole gallery land. Defensive by
    construction — any shape surprise returns None, never raises."""
    try:
        entries = json.loads(text)
        urls: list[str] = []
        caption = ""
        for entry in entries:
            if (
                isinstance(entry, list)
                and len(entry) >= 3
                and entry[0] == 3
                and isinstance(entry[1], str)
                and entry[1].startswith("http")
            ):
                urls.append(entry[1])
                if not caption:
                    meta = entry[2] if isinstance(entry[2], dict) else {}
                    caption = str(meta.get("description") or "")
        if urls:
            return urls, caption
    except Exception:
        pass
    return None


async def _instagram_gallery_dl(url: str) -> tuple[list[str], str] | None:
    """All full-size image URLs + caption via gallery-dl and the ADR-012 cookie
    jar. None when cookies are absent, the tool is missing (dev venv), or
    extraction fails — the caller falls down the tier ladder."""
    from backend.core.app_settings import cookies_present, get_cookies_path

    if not cookies_present():
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "gallery-dl", "-j", "--cookies", str(get_cookies_path()), url,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=45)
        except asyncio.TimeoutError:
            proc.kill()
            return None
        if proc.returncode != 0 or not out:
            return None
        return _parse_gallery_dl_dump(out.decode("utf-8", "replace"))
    except (FileNotFoundError, OSError, NotImplementedError):
        # Tool missing (dev venv) or the running event loop can't spawn
        # subprocesses — fall down the ladder instead of failing the save.
        return None


def _instagram_needs_cookies(url: str, domain: str) -> dict:
    """Graceful fallback when every IG tier is blocked: a real LINK memo (never a
    dead 'video' card) whose description tells the user to connect Instagram.
    Retryable — once a session exists, re-saving resolves it fully."""
    log.info("instagram unresolved (login/rate-limit): %s", url)
    return {
        "title": "Instagram post",
        "description": (
            "Couldn't pull this Instagram post — Instagram now requires a login "
            "to read post media. Connect Instagram in Settings, then save the "
            "link again to pull the photo(s)."
        ),
        "content_text": url,
        "source_url": canonical_source_url(url),
        "source_domain": domain,
        "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
        "thumbnail_path": "",
        "type": "link",
    }


async def _instagram_resolve(url: str, domain: str) -> dict:
    """Resolve any Instagram post (photo / carousel / video) to a memo dict.

    Tier ladder, cheapest-first (see core/instagram.py for the API details):
      1. guest media-info API, no cookies   — works from a "warm" IP
      2. guest media-info API + cookie jar  — a logged-in session is trusted
         even from a rate-limited IP (yt_cookies.txt: ADR-012 + in-app login)
      3. gallery-dl + cookies                — all carousel slides, full-res
      4. headless logged-in DOM grab         — single largest rendered image
      5. graceful needs-login LINK memo      — never a dead card
    A carousel becomes a `gallery` (type=image, first slide = thumbnail); a
    single photo is type=image; a single video keeps the video/embed shape with
    a real poster. Always returns a dict (never None) — the caller stores it."""
    from backend.core.app_settings import cookies_present, get_cookies_path
    from backend.core.instagram import fetch_media_info

    fav = f"https://www.google.com/s2/favicons?domain={domain}&sz=32"
    cookies = get_cookies_path() if cookies_present() else None

    # Tiers 1–2: the guest media-info API (anonymous, then with the session jar).
    info = await fetch_media_info(url)
    if info is None and cookies is not None:
        info = await fetch_media_info(url, cookies_path=cookies)
    if info is not None:
        caption = info.get("caption") or ""
        base = {
            "title": info.get("title") or "Instagram post",
            "description": caption[:500],
            "content_text": caption,
            "source_url": canonical_source_url(url),
            "source_domain": domain,
            "source_favicon": fav,
            # Signed CDN URLs expire (oe=) — ingest.cache_thumbnail localizes the
            # thumbnail right after save so the memo survives the post's deletion.
            "thumbnail_path": info.get("thumbnail") or "",
        }
        if info.get("media_type") == "carousel":
            base["gallery"] = info.get("gallery")
            base["type"] = "image"
        elif info.get("media_type") == "video":
            base["video_description"] = caption
            base["type"] = "video"
        else:
            base["type"] = "image"
        return base

    # Tier 3 — gallery-dl (cookies): all carousel slides, uncropped.
    full = await _instagram_gallery_dl(url)
    if full and full[0]:
        urls, caption = full
        slides = [{"url": u, "type": "image"} for u in urls]
        return {
            "title": (caption.splitlines()[0].strip() if caption else "") or "Instagram post",
            "description": caption[:500],
            "content_text": caption,
            "source_url": canonical_source_url(url),
            "source_domain": domain,
            "source_favicon": fav,
            "thumbnail_path": urls[0],
            "gallery": slides if len(slides) > 1 else None,
            "type": "image",
        }

    # Tier 4 — headless render, largest visible image (needs a logged-in context;
    # unavailable in dev where patchright isn't installed → skipped gracefully).
    try:
        from backend.core.headless import render_page

        rendered = await render_page(url, want_main_image=True)
        main_img = (rendered or {}).get("main_image")
        if main_img:
            return {
                "title": "Instagram post",
                "description": "",
                "content_text": "",
                "source_url": canonical_source_url(url),
                "source_domain": domain,
                "source_favicon": fav,
                "thumbnail_path": main_img,
                "type": "image",
            }
    except Exception:
        pass

    # Tier 5 — nothing worked: a clean, retryable needs-login link.
    return _instagram_needs_cookies(url, domain)


async def _fetch_og_meta(url: str, user_agent: str | None = None) -> dict:
    """Last-resort metadata extractor: fetch the page with a browser UA and
    parse OpenGraph / Twitter card / <title> tags.

    Used when both yt-dlp and Microlink fail (Microlink rate limit, free-tier
    flake, regional block). No third-party dependency, no API key.
    `user_agent` overrides the browser UA for hosts that only serve OG tags to
    link-preview crawlers (Instagram — see _CRAWLER_UA).
    """
    headers = {
        "User-Agent": user_agent or _BROWSER_UA_HTML,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(
            timeout=15.0, follow_redirects=True, headers=headers
        ) as client:
            resp = await client.get(url)
            if resp.status_code >= 400 or not resp.text:
                return {}
            soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return {}

    def _meta(prop: str, attr: str = "property") -> str:
        tag = soup.find("meta", attrs={attr: prop})
        if tag and tag.get("content"):
            return tag["content"].strip()
        return ""

    title = (
        _meta("og:title")
        or _meta("twitter:title", "name")
        or (soup.title.get_text().strip() if soup.title else "")
    )
    description = (
        _meta("og:description")
        or _meta("twitter:description", "name")
        or _meta("description", "name")
    )
    thumbnail = (
        _meta("og:image")
        or _meta("og:image:secure_url")
        or _meta("twitter:image", "name")
        or _meta("twitter:image:src", "name")
    )
    # og:video presence distinguishes a video page from a photo page on hosts
    # where both carry og:image (Instagram — a reel's og:image is its poster).
    video_url = _meta("og:video") or _meta("og:video:url") or _meta("og:video:secure_url")

    return {
        "title": title,
        "description": description,
        "thumbnail_path": thumbnail,
        "video_url": video_url,
    }


async def _minimal_link(url: str, domain: str | None = None) -> dict:
    """Resolve a memo for a URL the plain fetch could not read -- hardest path last.

    Chain: headless browser (renders past Cloudflare/JS challenges, returns full
    title + image + content) -> direct OpenGraph scrape (cheap, for pages that
    only needed a browser UA) -> a `preview_unavailable` card so a save never
    dead-ends. No Microlink / third-party API."""
    from urllib.parse import urlparse as _up
    if not domain:
        domain = _up(url).netloc.lstrip("www.")

    # 1) Real browser -- beats antibot walls, returns full content when it can.
    # On a photo page (FB/IG/X photo, …) the platform serves a generic og:image
    # to scrapers but renders the real photo in the DOM, so ask for the largest
    # rendered image and prefer it. General: keyed off the centralized
    # _url_media_hint, no per-host code.
    is_photo = _url_media_hint(url) == "image"
    try:
        from backend.core.headless import render_page

        rendered = await render_page(url, want_main_image=is_photo)
        if rendered and rendered.get("html"):
            parsed = _parse_html(rendered["html"], url, url, domain)
            main_img = rendered.get("main_image")
            if parsed is None and is_photo and main_img:
                # Photo page with no usable OG/text in the rendered DOM (FB/IG
                # inject OG tags server-side for scrapers only). Keep the real
                # image and borrow title/description from the scraper HTML so
                # the memo isn't titled with its own raw URL.
                og = await _fetch_og_meta(url)
                parsed = {
                    "title": og.get("title") or url,
                    "description": og.get("description") or "",
                    "content_text": og.get("description") or "",
                    "content_raw": "",
                    "source_url": url,
                    "source_domain": domain,
                    "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
                    "thumbnail_path": "",
                    "type": "link",
                }
            if parsed is not None:
                if is_photo and main_img:
                    parsed["thumbnail_path"] = main_img
                return parsed
    except Exception:
        pass

    # 2) Direct OG scrape (browser UA) -- for pages that block only the API path.
    enrichment = await _fetch_og_meta(url)

    has_meta = bool(enrichment.get("title") or enrichment.get("thumbnail_path"))
    description = enrichment.get("description") or (
        "" if has_meta else f"Preview unavailable -- {domain} blocked metadata extraction. Open the original to view."
    )
    return {
        "title": enrichment.get("title") or url,
        "description": description,
        "content_text": enrichment.get("description") or url,
        "source_url": url,
        "source_domain": domain,
        "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
        "thumbnail_path": enrichment.get("thumbnail_path") or "",
        "type": "link",
    }
