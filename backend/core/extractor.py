"""Content extractors for URLs, PDFs, documents, images."""
import re
import json
import base64
from pathlib import Path
from urllib.parse import urlparse, urljoin

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


async def extract_url(url: str) -> dict:
    """Extract content from a URL (article, page)."""
    parsed_url = urlparse(url)
    domain = parsed_url.netloc.lstrip("www.")

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
            html = resp.text
        except httpx.HTTPStatusError:
            return await _minimal_link(url, domain)
        except Exception:
            return await _minimal_link(url, domain)
    
    soup = BeautifulSoup(html, "lxml")
    base_url = str(resp.url)
    jsonld = _extract_jsonld(soup)

    # Title: og:title → schema headline → <title>
    title = (
        _meta(soup, "property", "og:title")
        or next((o["headline"] for o in jsonld if isinstance(o.get("headline"), str)), "")
        or (soup.title.string.strip() if soup.title and soup.title.string else "")
    )

    # Description: meta description → og:description → schema
    description = (
        _meta(soup, "name", "description")
        or _meta(soup, "property", "og:description")
        or _meta(soup, "name", "twitter:description")
        or next((o["description"] for o in jsonld if isinstance(o.get("description"), str)), "")
    )

    thumbnail = _pick_image(soup, jsonld, base_url)

    parsed = urlparse(url)
    domain = parsed.netloc
    favicon = f"https://www.google.com/s2/favicons?domain={domain}&sz=32"

    # Main content root, junk stripped, image src made absolute.
    root = _clean_content_node(soup)
    for img in root.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if src and not src.startswith("data:"):
            img["src"] = urljoin(base_url, src)
        elif not src:
            img.decompose()
    for a in root.find_all("a", href=True):
        a["href"] = urljoin(base_url, a["href"])

    content_html = str(root)

    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.body_width = 0
    content_text = h.handle(content_html)
    content_text = re.sub(r"\n{3,}", "\n\n", content_text).strip()

    return {
        "title": title.strip(),
        "description": description.strip(),
        "content_text": content_text,
        # Markdown (not raw HTML) — MemoDetail renders this via ReactMarkdown.
        "content_raw": content_text,
        "source_url": url,
        "source_domain": domain,
        "source_favicon": favicon,
        "thumbnail_path": thumbnail,
        # Saved web pages are filed as "link" (the UI has no Article tab — a
        # webpage IS a link). See backend/core/classify.py for the taxonomy.
        "type": "link",
    }


async def extract_youtube(url: str) -> dict:
    """Extract YouTube video metadata and transcript."""
    import subprocess
    import json
    
    parsed = urlparse(url)
    video_id = ""
    if "youtube.com" in parsed.netloc:
        from urllib.parse import parse_qs
        params = parse_qs(parsed.query)
        video_id = params.get("v", [""])[0]
    elif "youtu.be" in parsed.netloc:
        video_id = parsed.path.strip("/")
    
    # Use yt-dlp to extract metadata
    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            title = data.get("title", "")
            description = data.get("description", "")
            thumbnail = data.get("thumbnail", "")
            duration = data.get("duration", 0)
            
            # Try to get subtitles
            transcript = ""
            sub_result = subprocess.run(
                ["yt-dlp", "--write-auto-sub", "--sub-lang", "en",
                 "--skip-download", "--print", "%(subtitles)j", url],
                capture_output=True, text=True, timeout=30,
            )
            
            return {
                "title": title,
                "description": description[:500],
                "content_text": description,
                "source_url": url,
                "source_domain": "youtube.com",
                "source_favicon": "https://www.google.com/s2/favicons?domain=youtube.com&sz=32",
                "thumbnail_path": thumbnail,
                "type": "video",
            }
    except Exception as e:
        pass

    # Fallback: scrape YouTube page for og:title
    title = f"YouTube Video ({video_id})"
    description = ""
    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "lxml")
                og_title = soup.find("meta", property="og:title")
                if og_title and og_title.get("content"):
                    title = og_title["content"]
                elif soup.title and soup.title.string:
                    # Strip " - YouTube" suffix
                    title = soup.title.string.replace(" - YouTube", "").strip()
                og_desc = soup.find("meta", property="og:description")
                if og_desc and og_desc.get("content"):
                    description = og_desc["content"]
    except Exception:
        pass

    return {
        "title": title,
        "description": description,
        "content_text": description,
        "source_url": url,
        "source_domain": "youtube.com",
        "source_favicon": "https://www.google.com/s2/favicons?domain=youtube.com&sz=32",
        "thumbnail_path": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        "type": "video",
    }


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


_SOCIAL_VIDEO_DOMAINS = (
    "facebook.com", "fb.com", "fb.watch",
    "instagram.com",
    "tiktok.com",
    "twitter.com", "x.com",
    "threads.net",
    "pinterest.com",
    "snapchat.com",
    "vimeo.com",
    "twitch.tv",
    "reddit.com",
)


def detect_url_type(url: str) -> str:
    """Detect content type from URL."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if "youtube.com" in domain or "youtu.be" in domain:
        return "youtube"
    if any(d in domain for d in _SOCIAL_VIDEO_DOMAINS):
        return "social_video"
    return "article"


async def extract_social_video(url: str) -> dict:
    """Extract metadata from social/video platforms via yt-dlp.

    Falls back to a minimal link memo when yt-dlp can't access the content
    (private posts, login-required, unsupported pages).
    """
    import subprocess
    from urllib.parse import urlparse as _up

    parsed = _up(url)
    domain = parsed.netloc.lstrip("www.")

    try:
        result = subprocess.run(
            ["yt-dlp", "--dump-json", "--no-download",
             "--no-warnings", "--socket-timeout", "20", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            data = json.loads(result.stdout.strip().splitlines()[0])
            title = data.get("title") or data.get("fulltitle") or ""
            description = data.get("description") or ""
            thumbnail = (
                data.get("thumbnail")
                or (data.get("thumbnails") or [{}])[-1].get("url", "")
            )
            uploader = data.get("uploader") or data.get("channel") or ""
            if uploader and title:
                description = f"{uploader}\n\n{description}" if description else uploader
            return {
                "title": title or url,
                "description": description[:500],
                "content_text": description,
                "source_url": url,
                "source_domain": domain,
                "source_favicon": f"https://www.google.com/s2/favicons?domain={domain}&sz=32",
                "thumbnail_path": thumbnail,
                "type": "video",
            }
    except Exception:
        pass

    # yt-dlp failed — try Microlink for OG metadata + thumbnail
    return await _minimal_link(url, domain)


async def _fetch_microlink(url: str) -> dict:
    """Call Microlink API to get OG title/description/image for bot-walled pages.

    Returns a partial dict with whatever Microlink could fetch; empty dict on failure.
    Free tier, no API key required.
    """
    import urllib.parse
    api = f"https://api.microlink.io/?url={urllib.parse.quote(url, safe='')}&screenshot=true&meta=true"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(api)
            if resp.status_code != 200:
                return {}
            body = resp.json()
        if body.get("status") != "success":
            return {}
        data = body.get("data", {})
        thumbnail = (
            (data.get("image") or {}).get("url")
            or (data.get("screenshot") or {}).get("url")
            or ""
        )
        return {
            "title": data.get("title") or "",
            "description": data.get("description") or "",
            "thumbnail_path": thumbnail,
        }
    except Exception:
        return {}


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
    """Minimal memo dict enriched via Microlink → direct OG scrape fallback.

    The chain is deliberate: Microlink first because it handles SPA/JS-heavy
    pages, then a direct HTML fetch + OG parse for pages where Microlink's
    free tier flakes (FB reels regularly fall here). If both fail, return the
    raw URL + a `preview_unavailable` flag so the card can surface that to
    the user instead of silently rendering a gradient placeholder.
    """
    from urllib.parse import urlparse as _up
    if not domain:
        domain = _up(url).netloc.lstrip("www.")

    enrichment = await _fetch_microlink(url)
    if not (enrichment.get("title") and enrichment.get("thumbnail_path")):
        # Try direct OG scrape, merging any missing fields
        og = await _fetch_og_meta(url)
        if og:
            enrichment = {
                "title": enrichment.get("title") or og.get("title", ""),
                "description": enrichment.get("description") or og.get("description", ""),
                "thumbnail_path": enrichment.get("thumbnail_path") or og.get("thumbnail_path", ""),
            }

    has_meta = bool(enrichment.get("title") or enrichment.get("thumbnail_path"))
    description = enrichment.get("description") or (
        "" if has_meta else f"Preview unavailable — {domain} blocked metadata extraction. Open the original to view."
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
