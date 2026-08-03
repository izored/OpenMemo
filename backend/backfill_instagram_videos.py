"""Backfill: rescue Instagram videos that were saved as poster-frame images.

Before the tier-4 fix (plan 025), every Instagram post resolved through the
headless tier came back `type="image"` — so a reel became a memo of its poster
frame and no download path ever touched it (auto-localize only fires for
`type == "video"`). This walks the stuck memos, works out what each post really
is, and pulls the video.

Two candidate buckets:
  A. IG memos typed image/link with no local file — the misfiled ones. Each is
     probed: a /reel|/reels|/tv permalink is a video by its URL alone; anything
     else (/p/ can be either) gets one browser pass via the network sniffer.
  B. IG memos already typed video with no local file — nothing to reclassify,
     they just never got their download (or it errored). Retried as-is.

Dry run by default: it probes, reports, and changes nothing.

    docker exec openmemo-openmemo-api-1 python -m backend.backfill_instagram_videos
    docker exec openmemo-openmemo-api-1 python -m backend.backfill_instagram_videos --apply

Run it inside the container — the sniffer needs patchright, which is installed
in the image and not in the dev venv. Safe to re-run: a memo that now has a
file is no longer a candidate.
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import datetime

from sqlalchemy import select

from backend.core.extractor import _is_instagram_video_path
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

# Space out the probes/downloads so a backlog drain never looks like a scraper
# burst — the same courtesy the Telegram relay applies to a batch of links.
_DELAY_S = (8, 20)


async def _candidates() -> tuple[list[Memo], list[Memo]]:
    """(misfiled, never_downloaded) — IG memos with no local media file."""
    async with AsyncSessionLocal() as db:
        rows = (
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

    misfiled, undownloaded = [], []
    for m in rows:
        if m.file_path:
            continue
        kind = (m.type or "").lower()
        if kind == "video":
            undownloaded.append(m)
        elif kind == "image" and not m.gallery:
            # A carousel is a real gallery, not a misfiled video — leave it.
            # `link` memos are skipped on purpose: those are the needs-login
            # bookmarks, and re-sharing the URL upgrades them in place with a
            # fresh title and caption (the stale-IG-link path in api/ingest).
            misfiled.append(m)
    return misfiled, undownloaded


async def _probe(url: str) -> tuple[str, str]:
    """(verdict, why) for one post: "video" | "image" | "unknown"."""
    if _is_instagram_video_path(url):
        return "video", "url-path"
    try:
        from backend.core.sniff_media import sniff_media

        probe = await sniff_media(url, want_image=True)
    except Exception as e:
        return "unknown", f"probe failed: {e!r}"[:80]
    if not probe:
        return "unknown", "nothing rendered"
    if probe.get("media_url"):
        return "video", "video on the wire"
    return "image", "no video on the wire"


async def _promote_and_download(memo_id: str) -> str:
    """Pull the video for one memo. Returns the end status.

    The type is deliberately NOT flipped up front: `localize_memo_task` sets
    `type=video` itself once the file is actually on disk. So a download that
    fails leaves an image memo (retryable, still a candidate next run) instead
    of a video card with nothing behind it."""
    from backend.api.ingest import localize_memo_task

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return "gone"
        memo.localize_status = "pending"
        memo.localize_error = None
        memo.updated_at = datetime.utcnow()
        await db.commit()

    await localize_memo_task(memo_id, "video")

    async with AsyncSessionLocal() as db:
        memo = await db.get(Memo, memo_id)
        if not memo:
            return "gone"
        if memo.file_path:
            return "downloaded"
        return f"failed: {(memo.localize_error or 'unknown')[:80]}"


async def main() -> None:
    try:
        await _run()
    finally:
        # The probe leaves a warm Chromium behind; without this the dry-run
        # path exits with it still running and Python's GC screams about a
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
    args = ap.parse_args()

    misfiled, undownloaded = await _candidates()
    print(f"Instagram memos with no local file: {len(misfiled)} misfiled, {len(undownloaded)} never downloaded")
    print(f"mode: {'APPLY' if args.apply else 'DRY RUN'}\n")

    work: list[Memo] = []
    for i, memo in enumerate(misfiled):
        if args.limit and len(work) >= args.limit:
            break
        verdict, why = await _probe(memo.source_url or "")
        print(f"  [{verdict:7}] {memo.id[:8]}  {(memo.source_url or '')[:58]}  ({why})")
        if verdict == "video":
            work.append(memo)
        # Only sleep between real browser probes, and never after the last one.
        if why != "url-path" and i < len(misfiled) - 1:
            await asyncio.sleep(random.uniform(*_DELAY_S))

    for memo in undownloaded:
        if args.limit and len(work) >= args.limit:
            break
        print(f"  [retry  ] {memo.id[:8]}  {(memo.source_url or '')[:58]}  (already typed video)")
        work.append(memo)

    print(f"\n{len(work)} memo(s) to download.")
    if not args.apply:
        print("Dry run — nothing changed. Re-run with --apply to download.")
        return

    done = failed = 0
    for i, memo in enumerate(work):
        status = await _promote_and_download(memo.id)
        print(f"  {memo.id[:8]}  {status}")
        if status == "downloaded":
            done += 1
        else:
            failed += 1
        if i < len(work) - 1:
            await asyncio.sleep(random.uniform(*_DELAY_S))

    print(f"\nDone: {done} downloaded, {failed} failed.")


if __name__ == "__main__":
    asyncio.run(main())
