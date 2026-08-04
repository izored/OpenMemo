"""Re-download the media files a memo references but no longer has on disk.

Written after 2026-08-04, when an unisolated test run deleted 435 media files.
The database was untouched, so every memo still knows where its media came
from — which is what makes this possible at all. Of those 435, 376 carry a
`source_url`; this walks them and pulls each one back through the SAME
pipeline a live "make it local" uses (`localize_memo_task`), so Apple Music
and Spotify go to their track resolvers, everything else to yt-dlp and the
sniffer. No new download code, no new failure modes.

The other 59 are uploads with no source. Nothing can fetch those — see
`list_lost_uploads.py` for the hand-search checklist.

Dry run by default: it reports what it would fetch and changes nothing.

    docker exec openmemo-openmemo-api-1 python -m backend.refetch_missing_media
    docker exec openmemo-openmemo-api-1 python -m backend.refetch_missing_media --apply

Run it inside the container, where yt-dlp, ffmpeg and the resolvers live, and
where FILES_DIR is the same directory the app serves. Running it from a git
worktree writes the files into that worktree's empty `files/` instead — the
banner prints the paths it is about to use, so read it before answering yes.

Resumable and safe to re-run: a memo whose file is back is no longer a
candidate, so an interrupted run picks up where it stopped. Ctrl-C prints the
report for what it managed. Nothing is ever deleted.

Useful narrowings, since the mix behaves very differently per host:

    --host music.apple.com     one platform at a time
    --limit 5                  prove it works before committing to 376
    --delay 8                  slower, if a host starts refusing
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select

from backend.config import settings
from backend.core.file_paths import resolve_memo_path
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo

# Space out the fetches. A backlog drain should not look like a scraper burst —
# the same courtesy the Telegram relay and the Instagram backfill apply.
_DELAY_S = 4.0


def _host(url: str | None) -> str:
    try:
        return urlparse(url or "").netloc.replace("www.", "") or "?"
    except ValueError:
        return "?"


async def _candidates(host_filter: str = "") -> list[Memo]:
    """Memos whose media file is gone but whose source can still be fetched.

    `resolve_memo_path` is the app's own tolerant lookup, so a memo saved under
    Docker's `/app/files/...` and checked from Windows still counts as present.
    Only a file that resolves nowhere is treated as missing."""
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Memo)
                .where(
                    Memo.file_path.isnot(None),
                    Memo.file_path != "",
                    Memo.source_url.isnot(None),
                    Memo.source_url != "",
                    # NULL-safe: rows saved before the column existed have
                    # is_deleted = NULL, and `== False` alone would skip them.
                    (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
                )
                .order_by(Memo.created_at)
            )
        ).scalars().all()

    out = []
    for m in rows:
        if resolve_memo_path(m.file_path) is not None:
            continue
        if host_filter and host_filter.lower() not in _host(m.source_url).lower():
            continue
        out.append(m)
    return out


async def _refetch(memo: Memo) -> tuple[bool, str]:
    """Pull one memo's media back. Returns (ok, detail).

    `localize_memo_task` never raises — it writes done|error onto the memo — so
    the verdict comes from re-reading the row afterwards. An audio memo asks for
    audio: that is what the original save produced, and for a YouTube source it
    is the same video→audio conversion the user chose at the time."""
    from backend.api.ingest import localize_memo_task

    mode = "audio" if (memo.type or "").lower() == "audio" else "video"
    before = memo.file_path

    async with AsyncSessionLocal() as db:
        row = await db.get(Memo, memo.id)
        if not row:
            return False, "memo gone"
        row.localize_status = "pending"
        row.localize_error = None
        await db.commit()

    await localize_memo_task(memo.id, mode)

    async with AsyncSessionLocal() as db:
        row = await db.get(Memo, memo.id)
        if not row:
            return False, "memo gone"
        if resolve_memo_path(row.file_path) is not None:
            same = " (same path)" if row.file_path == before else ""
            return True, f"{(row.file_path or '').split('/')[-1][:52]}{same}"
        return False, (row.localize_error or "no file after localize")[:90]


def _report(done: list[str], failed: list[tuple[Memo, str]], total: int) -> None:
    print()
    print("=" * 78)
    print(f"  {len(done)} recovered, {len(failed)} failed, of {total} attempted")
    print("=" * 78)
    if failed:
        print()
        print("  Failures — reason first, so the pattern is visible:")
        by_host: dict[str, list[tuple[Memo, str]]] = {}
        for memo, why in failed:
            by_host.setdefault(_host(memo.source_url), []).append((memo, why))
        for host in sorted(by_host, key=lambda h: -len(by_host[h])):
            print(f"\n  {host}  ({len(by_host[host])})")
            for memo, why in by_host[host]:
                print(f"    {memo.id[:8]}  {(memo.title or '')[:40]:40}  {why}")
        print()
        print("  Re-running only retries these — everything recovered is now")
        print("  on disk and no longer a candidate.")


async def main() -> None:
    # Memo titles carry emoji, and a Windows console is cp1252 — without this a
    # long run dies mid-way on a title instead of printing a "?".
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="actually download (default: dry run)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N memos (0 = all)")
    ap.add_argument("--host", default="", help="only this host, e.g. music.apple.com")
    ap.add_argument("--delay", type=float, default=_DELAY_S, help=f"seconds between fetches (default {_DELAY_S})")
    args = ap.parse_args()

    print("=" * 78)
    print("  refetch missing media")
    print("=" * 78)
    # Absolute, always: inside the container both of these are relative, and a
    # banner that says "files" tells you nothing about which files.
    print(f"  database : {Path(settings.DATABASE_URL.split('///')[-1]).resolve()}")
    print(f"  files    : {Path(settings.FILES_DIR).resolve()}")
    print(f"  mode     : {'APPLY — downloads will be written' if args.apply else 'DRY RUN'}")
    print("=" * 78)
    print()

    memos = await _candidates(args.host)
    if not memos:
        print("Nothing missing. Every memo's media resolves on disk.")
        return

    counts = Counter(_host(m.source_url) for m in memos)
    print(f"Memos whose media is missing but re-fetchable: {len(memos)}")
    for host, n in counts.most_common():
        print(f"  {host:28} {n}")
    print()

    if args.limit:
        memos = memos[: args.limit]
        print(f"Limited to the {len(memos)} oldest.\n")

    if not args.apply:
        for m in memos[:20]:
            print(f"  [{(m.type or '?'):5}] {m.id[:8]}  {(m.title or '')[:44]:44}  {_host(m.source_url)}")
        if len(memos) > 20:
            print(f"  ... and {len(memos) - 20} more")
        print("\nDry run — nothing downloaded. Re-run with --apply.")
        return

    done: list[str] = []
    failed: list[tuple[Memo, str]] = []
    started = time.monotonic()

    try:
        for i, memo in enumerate(memos, 1):
            head = f"[{i:3}/{len(memos)}] {memo.id[:8]} {_host(memo.source_url):18}"
            print(f"{head} {(memo.title or '')[:38]:38} ", end="", flush=True)
            ok, detail = await _refetch(memo)
            if ok:
                done.append(memo.id)
                print(f"OK   {detail}")
            else:
                failed.append((memo, detail))
                print(f"FAIL {detail}")

            if i < len(memos) and args.delay > 0:
                await asyncio.sleep(random.uniform(args.delay * 0.6, args.delay * 1.4))
    except KeyboardInterrupt:
        print("\n\nInterrupted — everything downloaded so far is kept.")

    mins = (time.monotonic() - started) / 60
    _report(done, failed, len(done) + len(failed))
    print(f"\n  {mins:.1f} minutes.")


if __name__ == "__main__":
    asyncio.run(main())
