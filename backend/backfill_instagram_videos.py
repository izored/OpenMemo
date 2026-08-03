"""Backfill: repair Instagram memos that never got their real media.

Two things went wrong for posts saved without an Instagram session:

  • A reel arrived as a still. Every tier that can tell a video from a photo
    needs a login, so saves fell through to a browser that took the largest
    picture on the page and filed the memo as an image — and auto-download
    only fires for a video, so the file was never pulled (plan 025).
  • A carousel arrived as one photo. Only the media-info API hands over a
    sidecar's slide list, so without a session the memo got a single image
    and the gallery viewer had nothing to show.

This walks the affected memos, resolves each post through the SAME resolver
the app uses (`_instagram_resolve`), and applies whatever it finds: pulls the
video, attaches the full gallery, and fills in a real title/caption where the
memo still carries the "Instagram post" placeholder. Nothing else is touched —
a title you edited yourself is left alone.

Dry run by default: it resolves, reports, and changes nothing.

    docker exec openmemo-openmemo-api-1 python -m backend.backfill_instagram_videos
    docker exec openmemo-openmemo-api-1 python -m backend.backfill_instagram_videos --apply

Run it inside the container — the browser fallback needs patchright, which is
installed in the image and not in the dev venv. Worth re-running after
connecting Instagram in Settings: with a session the resolver returns full
carousels and real captions in one request, so posts this could only partly
recover the first time come back complete. Safe to re-run either way — a memo
that already has its media is no longer a candidate.
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import select

from backend.core.extractor import _instagram_resolve
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

# Space out the resolves so a backlog drain never looks like a scraper burst —
# the same courtesy the Telegram relay applies to a batch of links.
_DELAY_S = (8, 20)

_PLACEHOLDER_TITLES = {"Instagram post", "Instagram"}


async def _all_instagram() -> list[Memo]:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                select(Memo)
                .where(
                    Memo.source_url.like("%instagram.com%"),
                    # NULL-safe: rows saved before the column existed have
                    # is_deleted = NULL, and `== False` alone would skip them.
                    (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
                )
                .order_by(Memo.created_at)
            )
        ).scalars().all()


async def _candidates(captions_only: bool = False) -> list[Memo]:
    """Instagram memos worth re-resolving.

    Default: the ones missing media — no local file, or a single image that may
    really be a carousel. `captions_only`: the opposite set, memos whose media
    is already here but that still carry the "Instagram post" placeholder,
    because the tier that could read a caption needed a session nobody had."""
    rows = await _all_instagram()
    out = []
    for m in rows:
        kind = (m.type or "").lower()
        has_media = bool(m.file_path) or bool(m.gallery)
        if captions_only:
            if has_media and (m.title or "") in _PLACEHOLDER_TITLES:
                out.append(m)
        elif kind == "video" and not m.file_path:
            out.append(m)          # a video whose download never happened
        elif kind == "image" and not m.gallery:
            out.append(m)           # may be a misfiled reel, or a lone slide
    return out


async def _apply_caption(memo_id: str, resolved: dict) -> str:
    """Fill in a real title/caption on a memo whose media is already here.

    Touches nothing else: the file, gallery, type and thumbnail are already
    correct, and only the placeholder title is replaced — never a title the
    user may have written."""
    title = (resolved.get("title") or "").strip()
    if not title or title in _PLACEHOLDER_TITLES:
        return "no caption available"
    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return "gone"
        memo.resolve_tier = resolved.get("resolve_tier") or memo.resolve_tier
        if (memo.title or "") not in _PLACEHOLDER_TITLES:
            await db.commit()
            return "title already set"
        memo.title = title
        memo.description = resolved.get("description") or memo.description
        memo.content_text = resolved.get("content_text") or memo.content_text
        if (memo.type or "").lower() == "video":
            memo.video_description = (
                resolved.get("video_description")
                or resolved.get("content_text")
                or memo.video_description
            )
        memo.updated_at = datetime.utcnow()
        await db.commit()
    return f"caption: {title[:44]!r}"


async def _apply(memo_id: str, resolved: dict) -> str:
    """Write what the resolver found onto the memo. Returns a status word.

    The type is deliberately NOT flipped up front for a video: `localize_memo_task`
    sets `type=video` itself once the file is on disk, so a download that fails
    leaves the memo as it was (retryable, still a candidate) instead of a video
    card with nothing behind it."""
    from backend.api.ingest import cache_gallery, localize_memo_task

    gallery = resolved.get("gallery") or []
    is_video = resolved.get("type") == "video"
    notes = []

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return "gone"

        # Record which tier answered, same as a live save would — otherwise a
        # repaired memo carries no evidence of how well it resolved.
        memo.resolve_tier = resolved.get("resolve_tier") or memo.resolve_tier

        # A real caption beats the placeholder — but never overwrite a title
        # the user may have written themselves.
        title = (resolved.get("title") or "").strip()
        if title and title not in _PLACEHOLDER_TITLES and (memo.title or "") in _PLACEHOLDER_TITLES:
            memo.title = title
            memo.description = resolved.get("description") or memo.description
            memo.content_text = resolved.get("content_text") or memo.content_text
            notes.append("caption")

        if len(gallery) > 1:
            memo.gallery = gallery
            memo.thumbnail_path = gallery[0]["url"]
            notes.append(f"gallery x{len(gallery)}")

        if is_video:
            memo.localize_status = "pending"
            memo.localize_error = None
        elif (
            (memo.type or "").lower() == "video"
            and not memo.file_path
            and resolved.get("type") == "image"
        ):
            # A post typed video that resolves to photos was never a video:
            # the old fallback guessed from the URL, and a failed download left
            # the guess in place. Trust the resolver and drop the dead status
            # chip with it, or the memo renders as a video card with a gallery.
            # Only an "image" verdict may retype: a "link" is the needs-login
            # bookmark, which says nothing about what the post holds.
            memo.type = "image"
            memo.localize_status = None
            memo.localize_error = None
            notes.append("retyped image")

        memo.updated_at = datetime.utcnow()
        await db.commit()

    # Slides are signed CDN URLs that expire — pull them local right away.
    if len(gallery) > 1:
        await cache_gallery(memo_id)

    if is_video:
        await localize_memo_task(memo_id, "video")
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            if memo and memo.file_path:
                notes.append("video")
            else:
                err = (memo.localize_error if memo else "") or "unknown"
                notes.append(f"video FAILED: {err[:70]}")

    return ", ".join(notes) if notes else "nothing to change"


def _verdict(memo: Memo, resolved: dict) -> str:
    """One-line summary of what the resolver says this post really is."""
    kind = resolved.get("type")
    slides = len(resolved.get("gallery") or [])
    if kind == "video":
        return "video" if (memo.type or "").lower() != "video" else "video (retry)"
    if slides > 1:
        return f"carousel x{slides}"
    if kind == "link":
        return "blocked"
    return "single photo"


async def main() -> None:
    try:
        await _run()
    finally:
        # The resolver leaves a warm Chromium behind; without this the dry-run
        # path exits with it still running and Python's GC complains about a
        # closed event loop on the way out.
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
        "--captions",
        action="store_true",
        help="instead: fill real captions on memos whose media is already here",
    )
    args = ap.parse_args()

    memos = await _candidates(captions_only=args.captions)
    if args.limit:
        memos = memos[: args.limit]
    label = "still titled 'Instagram post'" if args.captions else "missing media"
    print(f"Instagram memos {label}: {len(memos)}")
    print(f"mode: {'APPLY' if args.apply else 'DRY RUN'}\n")

    changed = failed = 0
    for i, memo in enumerate(memos):
        url = memo.source_url or ""
        domain = urlparse(url).netloc.lstrip("www.") or "instagram.com"
        try:
            resolved = await _instagram_resolve(url, domain)
        except Exception as e:
            print(f"  [error   ] {memo.id[:8]}  {url[:52]}  ({e!r})"[:120])
            failed += 1
            continue

        verdict = "caption" if args.captions else _verdict(memo, resolved)
        line = f"  [{verdict:14}] {memo.id[:8]}  {url[:52]}"
        # "blocked" is the needs-login bookmark — there is nothing to write.
        # Everything else gets applied: even a plain photo can now trade its
        # "Instagram post" placeholder for the real caption.
        if args.apply and verdict != "blocked":
            if args.captions:
                status = await _apply_caption(memo.id, resolved)
            else:
                status = await _apply(memo.id, resolved)
            print(f"{line}  -> {status}")
            if "FAILED" in status:
                failed += 1
            else:
                changed += 1
        else:
            print(line)

        if i < len(memos) - 1:
            await asyncio.sleep(random.uniform(*_DELAY_S))

    print()
    if args.apply:
        print(f"Done: {changed} repaired, {failed} failed.")
    else:
        print("Dry run — nothing changed. Re-run with --apply.")


if __name__ == "__main__":
    asyncio.run(main())
