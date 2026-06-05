"""Content extractors for URLs, PDFs, documents, images."""
import re
import json
import base64
from pathlib import Path
from urllib.parse import urlparse, urljoin, unquote

import httpx
from bs4 import BeautifulSoup
import html2text

from backend.core.ollama_client import ollama_client


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


async def extract_url(url: str) -> dict:
    """Extract content from a URL (article, page).

    Plain HTTP fetch first (fast, covers most sites). If the response is a
    bot-challenge stub (non-200, e.g. Cloudflare 202) or a 200 that renders to
    nothing (JS SPA / antibot wall), escalate to `_minimal_link`, which drives a
    real headless browser past the challenge -- no Microlink, no paid API."""
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
            # JS stub). Route anything non-200, or a 200 that renders to nothing,
            # to the headless path in _minimal_link.
            if resp.status_code == 200:
                parsed = _parse_html(resp.text, str(resp.url), url, domain)
                if parsed is not None:
                    return parsed
        except Exception:
            pass

    return await _minimal_link(url, domain)


async def extract_pdf(file_path: str) -> dict:
    """Extract text from PDF."""
    import asyncio
    from PyPDF2 import PdfReader
    
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
    "threads.net",
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

    # yt-dlp failed (private, login-required, unsupported, or a non-video item
    # like a photo post) — enrich via Microlink + OG.
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


async def _fetch_og_meta(url: str) -> dict:
    """Last-resort metadata extractor: fetch the page with a browser UA and
    parse OpenGraph / Twitter card / <title> tags.

    Used when both yt-dlp and Microlink fail (Microlink rate limit, free-tier
    flake, regional block). No third-party dependency, no API key.
    """
    headers = {
        "User-Agent": _BROWSER_UA_HTML,
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

    return {
        "title": title,
        "description": description,
        "thumbnail_path": thumbnail,
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
                # Photo page with no usable OG/text — still keep the real image.
                parsed = {
                    "title": url,
                    "description": "",
                    "content_text": "",
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
