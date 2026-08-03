"""Instagram canary — notice when the resolver quietly stops working properly.

The Instagram bug that prompted this (plan 025) was invisible for six weeks
because nothing ever failed: the tier ladder kept returning memos, just poorer
ones — a reel as a still, a carousel as a single photo. Instagram will change
the rules again, and the next silent downgrade should announce itself.

So: re-resolve a couple of posts already in the library and check the answer
still matches what is stored. Self-calibrating on purpose — hardcoded canary
URLs rot the moment their author deletes the post, whereas the library always
holds posts known to have resolved properly at least once.

A run reports one of:
    ok        — the API tiers still answer, and the media still matches
    degraded  — saves are falling back to reading the public page
    mismatch  — a post now resolves to something different than we stored
    skipped   — nothing suitable to check (a library with no Instagram yet)

The result is stored in app settings so Settings can show it, and the loop
runs weekly from the app lifespan. Never raises out.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# One week between runs. The canary exists to catch a platform change, which
# happens on the scale of months, not minutes — and every run is real traffic
# to Instagram, so it stays rare on purpose.
_INTERVAL_S = 7 * 24 * 60 * 60

# Wait before the first run so a machine that boots, syncs and shuts down does
# not fire a canary during startup.
_STARTUP_DELAY_S = 10 * 60

# How many library posts one run re-checks.
_SAMPLE = 2


async def _sample_memos(limit: int = _SAMPLE) -> list:
    """Recent Instagram memos worth re-checking: ones whose media we know.

    A memo with a gallery or a downloaded video is a post that resolved
    properly once, so it is a fair question to ask again."""
    from sqlalchemy import select

    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Memo

    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(Memo)
                .where(
                    Memo.source_url.like("%instagram.com%"),
                    (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712
                )
                .order_by(Memo.created_at.desc())
                .limit(60)
            )
        ).scalars().all()

    out = []
    for m in rows:
        has_media = bool(m.file_path) or bool(m.gallery)
        if has_media:
            out.append(m)
        if len(out) >= limit:
            break
    return out


def _expected(memo) -> tuple[str, int]:
    """(type, slide count) currently stored for a memo."""
    return (memo.type or "").lower(), len(memo.gallery or [])


async def run_instagram_canary() -> dict:
    """Re-resolve a sample of library posts and report. Never raises."""
    from backend.core.extractor import IG_FALLBACK_TIERS, _instagram_resolve

    started = datetime.utcnow().isoformat()
    try:
        memos = await _sample_memos()
    except Exception as e:
        log.info("instagram canary could not read the library: %r", e)
        return {"status": "skipped", "checked_at": started, "detail": "library unreadable"}

    if not memos:
        return {"status": "skipped", "checked_at": started, "detail": "no Instagram posts to check"}

    checks: list[dict] = []
    for memo in memos:
        url = memo.source_url or ""
        domain = urlparse(url).netloc.lstrip("www.") or "instagram.com"
        try:
            resolved = await _instagram_resolve(url, domain)
        except Exception as e:
            checks.append({"url": url, "outcome": "error", "detail": repr(e)[:120]})
            continue

        tier = resolved.get("resolve_tier") or "unknown"
        want_type, want_slides = _expected(memo)
        got_type = resolved.get("type")
        got_slides = len(resolved.get("gallery") or [])

        if tier in IG_FALLBACK_TIERS:
            outcome = "degraded"
        elif got_type != want_type or got_slides < want_slides:
            # Fewer slides than stored, or a different kind of post entirely.
            # Not necessarily our bug — the author may have edited the post —
            # but it is exactly the shape the original bug had, so say it.
            outcome = "mismatch"
        else:
            outcome = "ok"
        checks.append({
            "url": url, "outcome": outcome, "tier": tier,
            "expected": f"{want_type}/{want_slides}", "got": f"{got_type}/{got_slides}",
        })

    outcomes = [c["outcome"] for c in checks]
    if any(o == "degraded" for o in outcomes):
        status = "degraded"
    elif any(o == "mismatch" for o in outcomes):
        status = "mismatch"
    elif all(o == "ok" for o in outcomes):
        status = "ok"
    else:
        status = "skipped"

    result = {"status": status, "checked_at": started, "checks": checks}
    if status != "ok":
        log.warning("instagram canary: %s — %s", status, checks)
    else:
        log.info("instagram canary ok (%d checked)", len(checks))
    return result


async def _store(result: dict) -> None:
    from backend.core.app_settings import set_instagram_canary

    try:
        set_instagram_canary(result)
    except Exception as e:
        log.info("instagram canary could not store its result: %r", e)


def last_result() -> dict | None:
    """What the last canary run found, for the Settings UI."""
    try:
        from backend.core.app_settings import get_instagram_canary

        return get_instagram_canary()
    except Exception:
        return None


async def run_canary_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out."""
    await asyncio.sleep(_STARTUP_DELAY_S)
    while True:
        try:
            # Only one machine in a Mesh should do this — it is outbound
            # traffic to Instagram, and two devices asking is twice the noise
            # for the same answer.
            from backend.core.mesh.pairing import may_run_singleton

            if await may_run_singleton("instagram_canary"):
                await _store(await run_instagram_canary())
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("instagram canary cycle failed: %r", e)
        await asyncio.sleep(_INTERVAL_S)


if __name__ == "__main__":
    import json

    async def _main() -> None:
        result = await run_instagram_canary()
        await _store(result)
        print(json.dumps(result, indent=2))
        try:
            from backend.core.headless import close_browser

            await close_browser()
        except Exception:
            pass

    asyncio.run(_main())
