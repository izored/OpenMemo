"""Site icons, held locally, one file per domain.

Every memo carried `https://www.google.com/s2/favicons?domain=<site>&sz=32` in
`source_favicon`, and the dashboard rendered it directly. So opening openMemo
fired one request to Google per card on screen, forever, and told Google the
domain of everything in the library while it was at it. In a 713-memo library
that was 660 rows pointing at Google.

It is the picture bug again at a smaller size (`backend/core/pictures.py`), with
one extra edge: an icon is per SITE, not per memo. 713 memos resolve to 39
distinct domains here, so the whole library costs 39 small files and the
fortieth Instagram save costs nothing at all.

Fetched at ingest, which is allowed to be online, never at render, which is not.
The site's own `/favicon.ico` is tried first so the common case involves nobody
but the site itself. Google's icon service is the last resort, and reaching it
once per new domain is a different thing from reaching it on every scroll.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from backend.config import settings

log = logging.getLogger(__name__)

FAVICONS_DIR = Path(settings.FILES_DIR) / "favicons"

# One filename per domain. Anything outside this set is replaced, so a hostile
# `source_domain` cannot walk out of the directory or collide with a real name.
_UNSAFE = re.compile(r"[^a-z0-9.-]")

_EXT_BY_CTYPE = {
    "image/png": ".png",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
}

# Anything bigger is not a site icon, it is someone serving a page (or a trap).
_MAX_BYTES = 512 * 1024


def safe_domain(domain: str | None) -> str | None:
    """The filename stem for a domain, or None if there is nothing usable."""
    if not domain:
        return None
    stem = _UNSAFE.sub("-", str(domain).strip().lower().removeprefix("www."))
    stem = stem.strip(".-")[:100]
    return stem or None


def existing(domain: str | None) -> Path | None:
    """The icon already on disk for this domain, whatever extension it took."""
    stem = safe_domain(domain)
    if not stem:
        return None
    for ext in (".png", ".ico", ".svg", ".webp", ".jpg", ".gif"):
        candidate = FAVICONS_DIR / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def local_ref(path: Path) -> str:
    return f"/api/files/favicon/{path.name}"


# domain stem → served path, or None for "looked, have nothing". Serving a list
# of 200 memos asks this 200 times for ~39 distinct answers, and the answer only
# changes when a download lands, which is the one place that clears it.
_REF_CACHE: dict[str, str | None] = {}


def ref_if_present(domain: str | None) -> str | None:
    """The served path for a domain we already hold, without touching the network."""
    stem = safe_domain(domain)
    if not stem:
        return None
    if stem not in _REF_CACHE:
        found = existing(stem)
        _REF_CACHE[stem] = local_ref(found) if found else None
    return _REF_CACHE[stem]


def forget(domain: str | None = None) -> None:
    """Drop cached answers. Called when an icon lands, and by tests."""
    stem = safe_domain(domain)
    if stem:
        _REF_CACHE.pop(stem, None)
    else:
        _REF_CACHE.clear()


async def ensure_local(domain: str | None) -> str | None:
    """The local path for this domain's icon, downloading it once if needed.

    Returns None when nothing could be fetched, and the caller leaves
    `source_favicon` empty: a card with no icon is honest, a card fetching one
    from Google is not.
    """
    stem = safe_domain(domain)
    if not stem:
        return None

    found = existing(stem)
    if found:
        return local_ref(found)

    import httpx

    # The site first, Google only if the site has nothing. Most sites answer.
    sources = [
        f"https://{stem}/favicon.ico",
        f"https://www.google.com/s2/favicons?domain={stem}&sz=64",
    ]

    FAVICONS_DIR.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(
        timeout=10,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; openMemo)"},
    ) as client:
        for url in sources:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if "image" not in ctype:
                    continue
                body = resp.content
                # Google answers 200 with a 1x1 placeholder for domains it does
                # not know. Storing that gives every unknown site a permanent
                # invisible icon and no way to notice.
                if not body or len(body) < 64 or len(body) > _MAX_BYTES:
                    continue
                target = FAVICONS_DIR / f"{stem}{_EXT_BY_CTYPE.get(ctype, '.png')}"
                target.write_bytes(body)
                forget(stem)
                return local_ref(target)
            except Exception:
                continue

    log.info("favicon: nothing fetchable for %s", stem)
    return None
