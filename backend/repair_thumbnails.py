"""Repair memos whose thumbnail points at a file that is no longer there.

A memo stores its cover as a local path (`/api/files/thumb/…` or
`/api/files/extracted/…`). If that file goes missing the card renders a broken
image and nothing ever puts it back: `cache_thumbnail` only re-downloads a
thumbnail that is still a remote http URL, and a dead local path is not one.

So the cover has to be re-derived. Cheapest source first, and only what the
memo already has on this machine before anything touches the network:

  1. a local media file  → pull a frame with ffmpeg (no network at all)
  2. a gallery           → the first slide that really exists on disk
  3. a source URL        → re-resolve the post and download the cover again
  4. nothing left        → clear the path, so the card shows its own
                           placeholder instead of a broken image

Dry run by default.

    docker exec openmemo-openmemo-api-1 python -m backend.repair_thumbnails
    docker exec openmemo-openmemo-api-1 python -m backend.repair_thumbnails --apply

Run it inside the container: step 3 needs the resolver's browser tier, and
FILES_DIR has to be the same one the app serves.
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select

from backend.config import settings
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

THUMBS_DIR = Path(settings.FILES_DIR) / "thumbs"

# Only used for step 3, which is the only step that goes near a network.
_DELAY_S = (4, 10)


def local_path_for(stored: str) -> Path | None:
    """The on-disk path a stored `/api/files/...` thumbnail refers to."""
    if not stored or not stored.startswith("/api/files/"):
        return None
    rel = stored.replace("/api/files/thumb/", "thumbs/").replace(
        "/api/files/extracted/", "extracted/"
    )
    return Path(settings.FILES_DIR) / rel


def is_broken(memo) -> bool:
    p = local_path_for(memo.thumbnail_path or "")
    return p is not None and not p.is_file()


async def _broken_memos() -> list[Memo]:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Memo)
                .where(
                    Memo.thumbnail_path.like("/api/files/%"),
                    (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
                )
                .order_by(Memo.created_at.desc())
            )
        ).scalars().all()
    return [m for m in rows if is_broken(m)]


async def _from_local_video(memo) -> str | None:
    """A frame from the memo's own media file. No network."""
    from backend.core.file_paths import resolve_memo_path
    from backend.core.video import extract_video_thumbnail

    src = resolve_memo_path(memo.file_path)
    if not src or not src.is_file():
        return None
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    out = THUMBS_DIR / f"{memo.id}.jpg"
    if await extract_video_thumbnail(str(src), out):
        return f"/api/files/thumb/{out.name}"
    return None


def _from_gallery(memo) -> str | None:
    """The first slide that is actually on disk."""
    for slide in (memo.gallery or []):
        url = (slide or {}).get("url") if isinstance(slide, dict) else None
        if not url or not url.startswith("/api/files/"):
            continue
        p = local_path_for(url)
        if p and p.is_file():
            return url
    return None


async def _from_source(memo) -> str | None:
    """Re-resolve the source and cache its cover again. Uses the network."""
    from backend.api.ingest import _download_thumb
    from backend.core.extractor import extract_url, extract_video, detect_url_type

    url = memo.source_url or ""
    if not url:
        return None
    try:
        if detect_url_type(url) == "video":
            data = await extract_video(url)
        else:
            data = await extract_url(url)
    except Exception:
        return None
    remote = (data or {}).get("thumbnail_path") or ""
    if not remote.startswith("http"):
        return None
    return await _download_thumb(remote, memo.id)


async def _repair(memo) -> tuple[str, str]:
    """(outcome, detail) for one memo. Never raises."""
    try:
        local = await _from_local_video(memo)
        if local:
            return "ffmpeg frame", local
    except Exception as e:
        pass

    slide = _from_gallery(memo)
    if slide:
        return "gallery slide", slide

    try:
        fetched = await _from_source(memo)
        if fetched:
            return "re-fetched", fetched
    except Exception:
        pass

    # Nothing left. An empty thumbnail renders the card's own placeholder,
    # which is honest; a dead path renders a broken image, which is not.
    return "cleared", ""


async def main() -> None:
    try:
        await _run()
    finally:
        try:
            from backend.core.headless import close_browser

            await close_browser()
        except Exception:
            pass


async def _run() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N memos (0 = all)")
    ap.add_argument(
        "--offline",
        action="store_true",
        help="only repairs that need no network (ffmpeg frames, gallery slides)",
    )
    args = ap.parse_args()

    memos = await _broken_memos()
    if args.limit:
        memos = memos[: args.limit]

    print(f"Memos whose thumbnail file is missing: {len(memos)}")
    print(f"mode: {'APPLY' if args.apply else 'DRY RUN'}{' (offline only)' if args.offline else ''}\n")

    counts: dict[str, int] = {}
    for i, memo in enumerate(memos):
        if args.offline:
            outcome, value = "skipped (needs network)", ""
            local = None
            try:
                local = await _from_local_video(memo)
            except Exception:
                local = None
            if local:
                outcome, value = "ffmpeg frame", local
            else:
                slide = _from_gallery(memo)
                if slide:
                    outcome, value = "gallery slide", slide
        else:
            outcome, value = await _repair(memo)

        counts[outcome] = counts.get(outcome, 0) + 1
        host = urlparse(memo.source_url or "").netloc or "no source"
        print(f"  [{outcome:22}] {memo.id[:8]}  {host[:26]:26}  {(memo.title or '')[:34]}")

        if args.apply and not outcome.startswith("skipped"):
            async with AsyncSessionLocal() as db:
                fresh = await db.get(Memo, memo.id)
                if fresh:
                    fresh.thumbnail_path = value or None
                    fresh.updated_at = datetime.utcnow()
                    await db.commit()

        # Only the network path deserves a pause.
        if outcome == "re-fetched" and i < len(memos) - 1:
            await asyncio.sleep(random.uniform(*_DELAY_S))

    print()
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3}  {k}")
    if not args.apply:
        print("\nDry run — nothing changed. Re-run with --apply.")


if __name__ == "__main__":
    asyncio.run(main())
