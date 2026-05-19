"""Localize extracted web content so saved memos survive source deletion.

Articles/links are stored as Markdown with absolute remote image URLs
(`![alt](https://…)`). If the source goes away, those images 404. This
downloads every referenced image into FILES_DIR/extracted/<memo_id>/ and
rewrites the references to the local `/api/files/extracted/...` route.

Idempotent: URLs already pointing at `/api/files/` are skipped.
"""

import hashlib
import re
from pathlib import Path

import httpx

from backend.config import settings
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

EXTRACTED_DIR = Path(settings.FILES_DIR) / "extracted"

# Markdown image: ![alt](url)  and HTML <img src="url">
_MD_IMG = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)\)")
_HTML_IMG = re.compile(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', re.I)

_CTYPE_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
    "image/bmp": ".bmp",
}


def _headers(src_url: str) -> dict:
    from urllib.parse import urlparse

    p = urlparse(src_url)
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "image/webp,image/avif,image/*,*/*;q=0.8",
        "Referer": f"{p.scheme}://{p.netloc}/",
    }


def _collect_urls(*texts: str | None) -> set[str]:
    urls: set[str] = set()
    for t in texts:
        if not t:
            continue
        urls.update(_MD_IMG.findall(t))
        urls.update(_HTML_IMG.findall(t))
    return urls


async def _download(client: httpx.AsyncClient, url: str, memo_id: str) -> str | None:
    try:
        resp = await client.get(url, headers=_headers(url))
        resp.raise_for_status()
        ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        if "image" not in ctype:
            return None
        ext = _CTYPE_EXT.get(ctype, ".jpg")
        digest = hashlib.sha1(url.encode()).hexdigest()[:16]
        target_dir = EXTRACTED_DIR / memo_id
        target_dir.mkdir(parents=True, exist_ok=True)
        saved = target_dir / f"{digest}{ext}"
        saved.write_bytes(resp.content)
        return f"/api/files/extracted/{memo_id}/{digest}{ext}"
    except Exception:
        return None


async def localize_memo(memo_id: str) -> int:
    """Download remote images for a memo and rewrite references. Returns count."""
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return 0

        urls = _collect_urls(memo.content_raw, memo.content_text)
        thumb = memo.thumbnail_path
        localize_thumb = bool(thumb and thumb.startswith("http"))

        if not urls and not localize_thumb:
            return 0

        mapping: dict[str, str] = {}
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for url in urls:
                local = await _download(client, url, memo_id)
                if local:
                    mapping[url] = local
            if localize_thumb:
                local = await _download(client, thumb, memo_id)
                if local:
                    memo.thumbnail_path = local

        if mapping:
            def _swap(text: str | None) -> str | None:
                if not text:
                    return text
                for remote, local in mapping.items():
                    text = text.replace(remote, local)
                return text

            memo.content_raw = _swap(memo.content_raw)
            memo.content_text = _swap(memo.content_text)

        if mapping or (localize_thumb and not memo.thumbnail_path.startswith("http")):
            from datetime import datetime

            memo.updated_at = datetime.utcnow()
            await db.commit()

        return len(mapping)


async def localize_all() -> dict:
    """Backfill: localize every memo that still has remote images. Background-safe."""
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(select(Memo.id).where(Memo.content_text.isnot(None)))
        ).scalars().all()

    processed = 0
    images = 0
    for mid in rows:
        n = await localize_memo(mid)
        if n:
            processed += 1
            images += n
    return {"memos_updated": processed, "images_localized": images}
