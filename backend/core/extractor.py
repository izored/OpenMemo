"""Content extractors for URLs, PDFs, documents, images."""
import re
import base64
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
import html2text

from backend.core.ollama_client import ollama_client


async def extract_url(url: str) -> dict:
    """Extract content from a URL (article, page)."""
    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; OpenMemo/1.0)"},
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text
    
    soup = BeautifulSoup(html, "lxml")
    
    # Extract metadata
    title = ""
    if soup.title:
        title = soup.title.string or ""
    og_title = soup.find("meta", property="og:title")
    if og_title:
        title = og_title.get("content", title)
    
    description = ""
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc:
        description = meta_desc.get("content", "")
    og_desc = soup.find("meta", property="og:description")
    if og_desc:
        description = og_desc.get("content", description)
    
    # Thumbnail
    thumbnail = ""
    og_image = soup.find("meta", property="og:image")
    if og_image:
        thumbnail = og_image.get("content", "")
    
    # Favicon
    parsed = urlparse(url)
    domain = parsed.netloc
    favicon = f"https://www.google.com/s2/favicons?domain={domain}&sz=32"
    
    # Extract body text using html2text
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = True
    h.body_width = 0
    
    # Try to find main content
    article = soup.find("article") or soup.find("main") or soup.find("body")
    content_html = str(article) if article else html
    content_text = h.handle(content_html)
    
    # Clean up
    content_text = re.sub(r'\n{3,}', '\n\n', content_text).strip()
    
    return {
        "title": title.strip(),
        "description": description.strip(),
        "content_text": content_text,
        "content_raw": content_html,
        "source_url": url,
        "source_domain": domain,
        "source_favicon": favicon,
        "thumbnail_path": thumbnail,
        "type": "article",
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
    except Exception:
        pass
    
    # Fallback: basic extraction
    return {
        "title": f"YouTube Video ({video_id})",
        "description": "",
        "content_text": "",
        "source_url": url,
        "source_domain": "youtube.com",
        "source_favicon": "https://www.google.com/s2/favicons?domain=youtube.com&sz=32",
        "thumbnail_path": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        "type": "video",
    }


async def extract_pdf(file_path: str) -> dict:
    """Extract text from PDF."""
    from PyPDF2 import PdfReader
    
    reader = PdfReader(file_path)
    pages_text = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages_text.append(text)
    
    content = "\n\n".join(pages_text)
    filename = Path(file_path).stem
    
    return {
        "title": filename,
        "description": content[:200] if content else "",
        "content_text": content,
        "type": "document",
    }


async def extract_docx(file_path: str) -> dict:
    """Extract text from DOCX."""
    from docx import Document
    
    doc = Document(file_path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    content = "\n\n".join(paragraphs)
    filename = Path(file_path).stem
    
    return {
        "title": filename,
        "description": content[:200] if content else "",
        "content_text": content,
        "type": "document",
    }


async def extract_image(file_path: str) -> dict:
    """Extract description from image using vision model."""
    with open(file_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")
    
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


def detect_url_type(url: str) -> str:
    """Detect content type from URL."""
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    
    if "youtube.com" in domain or "youtu.be" in domain:
        return "youtube"
    elif "twitter.com" in domain or "x.com" in domain:
        return "twitter"
    elif "reddit.com" in domain:
        return "reddit"
    else:
        return "article"
