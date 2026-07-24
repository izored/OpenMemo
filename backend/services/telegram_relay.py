"""Telegram capture relay (ADR-020).

Store-and-forward phone capture: the user shares a post URL from any app to
their private Telegram bot chat; this service polls Telegram OUTBOUND
(`getUpdates` — no webhook, no inbound port, no public URL) on an interval,
drains every pending message, and saves each URL through the exact same
pipeline as a WebUI paste (`ingest_url_core`). Telegram is the queue: with the
PC asleep, messages simply wait.

Security: messages are processed only when they come from the single locked
owner id. The lock is auto-captured from the FIRST sender after a token is
configured — anyone else is ignored (and logged). Token + owner id live in the
app-settings JSON and never cross the API (app_settings.py).

Cadence (user decision, plan instagram-telegram-capture): poll every
`telegram_poll_minutes` (default 15 — capture is not urgent), then keep an
"active window" of long-polls open for a few minutes after any activity so
collection-button taps get an instant response instead of waiting a full
interval.
"""
import asyncio
import logging
import random
import re
import uuid
from datetime import datetime

import httpx

from backend.core.app_settings import (
    get_settings,
    get_telegram_token,
    get_telegram_allowed_user,
    set_telegram_allowed_user,
)
from backend.db.database import AsyncSessionLocal

log = logging.getLogger(__name__)

_URL_RE = re.compile(r"https?://\S+")

# How long the post-activity long-poll window stays open, and each long-poll's
# timeout. 25 s is under Telegram's 50 s ceiling and under httpx's read timeout.
_ACTIVE_WINDOW_S = 300
_LONG_POLL_S = 25

# Jitter between two extractions in one batch — spaces out Instagram fetches so
# a backlog drain never looks like a scraper burst.
_BATCH_JITTER_S = (10, 30)

# Live status for the Settings UI (read via /api/settings/telegram/status).
RELAY_STATUS: dict = {
    "running": False,
    "last_poll_at": None,
    "last_error": None,
    "saved_count": 0,
}

# getUpdates offset lives in memory only. After a restart Telegram redelivers
# unacked updates; the ingest dedupe (source_url) makes reprocessing harmless.
_offset = 0


def _api(token: str, method: str) -> str:
    return f"https://api.telegram.org/bot{token}/{method}"


async def _tg(client: httpx.AsyncClient, token: str, method: str, **params):
    """One Telegram Bot API call. Returns the `result` payload or None."""
    try:
        resp = await client.post(_api(token, method), json=params)
        body = resp.json()
        if body.get("ok"):
            return body.get("result")
        log.warning("telegram %s failed: %s", method, body.get("description"))
    except Exception as e:
        log.warning("telegram %s error: %r", method, e)
    return None


def _fire_and_forget(coro, label: str) -> None:
    """Run a follow-up ingest job with logged exceptions (ingest.py pattern)."""
    task = asyncio.create_task(coro)

    def _done(t: asyncio.Task) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc:
            log.error("relay job %s failed: %r", label, exc)

    task.add_done_callback(_done)


async def _get_or_create_collection(db, name: str) -> str:
    """Id of the standard collection with this name (auto-created if missing)."""
    from sqlalchemy import select
    from backend.db.models import Collection

    coll = (
        await db.execute(
            select(Collection).where(
                Collection.name == name, Collection.kind == "standard"
            )
        )
    ).scalars().first()
    if coll is None:
        coll = Collection(
            id=str(uuid.uuid4()),
            workspace_id="default",
            name=name,
            emoji="📸",
            kind="standard",
        )
        db.add(coll)
        await db.commit()
    return coll.id


async def _save_url(url: str, collection_name: str) -> dict:
    """Save one URL through the shared ingest pipeline. Never raises."""
    from backend.api.ingest import URLIngest, ingest_url_core

    jobs: list[tuple] = []

    def schedule(fn, *args):
        jobs.append((fn, args))

    try:
        async with AsyncSessionLocal() as db:
            coll_id = await _get_or_create_collection(db, collection_name)
            data = URLIngest(url=url, collection_id=coll_id)
            result = await ingest_url_core(data, db, schedule)
    except Exception as e:
        log.warning("relay save failed for %s: %r", url, e)
        return {"status": "error", "url": url, "error": str(e)[:120]}

    for fn, args in jobs:
        _fire_and_forget(fn(*args), fn.__name__)
    result["url"] = url
    return result


async def _collection_buttons(memo_id: str) -> list:
    """Inline keyboard of standard collections for the re-file tap (Phase 3).
    callback_data is capped at 64 bytes by Telegram, so two 8-char id prefixes
    are used and resolved back with a LIKE match."""
    from sqlalchemy import select
    from backend.db.models import Collection

    async with AsyncSessionLocal() as db:
        colls = (
            await db.execute(
                select(Collection)
                .where(Collection.kind == "standard")
                .order_by(Collection.pinned.desc(), Collection.sort_order)
                .limit(8)
            )
        ).scalars().all()
    rows, row = [], []
    for c in colls:
        row.append({
            "text": f"{c.emoji or ''} {c.name}".strip()[:32],
            "callback_data": f"mv:{memo_id[:8]}:{c.id[:8]}",
        })
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    return rows


async def _handle_callback(client, token: str, cq: dict) -> None:
    """A collection button was tapped: move the memo, edit the receipt."""
    from sqlalchemy import select, delete, insert
    from backend.db.models import Memo, Collection, memo_collections

    cq_id = cq.get("id")
    data = cq.get("data") or ""
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != "mv":
        await _tg(client, token, "answerCallbackQuery", callback_query_id=cq_id)
        return
    memo8, coll8 = parts[1], parts[2]

    label = None
    try:
        async with AsyncSessionLocal() as db:
            memo = (
                await db.execute(select(Memo).where(Memo.id.like(f"{memo8}%")))
            ).scalars().first()
            coll = (
                await db.execute(
                    select(Collection).where(Collection.id.like(f"{coll8}%"))
                )
            ).scalars().first()
            if memo and coll:
                await db.execute(
                    delete(memo_collections).where(
                        memo_collections.c.memo_id == memo.id
                    )
                )
                await db.execute(
                    insert(memo_collections).values(
                        memo_id=memo.id, collection_id=coll.id
                    )
                )
                await db.commit()
                label = coll.name
    except Exception as e:
        log.warning("relay move failed (%s): %r", data, e)

    await _tg(
        client, token, "answerCallbackQuery",
        callback_query_id=cq_id,
        text=f"Moved to {label} ✓" if label else "Move failed",
    )
    msg = cq.get("message") or {}
    if label and msg.get("chat"):
        await _tg(
            client, token, "editMessageText",
            chat_id=msg["chat"]["id"],
            message_id=msg.get("message_id"),
            text=f"Saved → {label} ✓",
        )


async def _handle_message(client, token: str, msg: dict, settings: dict) -> str | None:
    """Process one incoming message. Returns "link" when a URL was ingested
    (the only case worth jitter-spacing), "chat" for other replies, None for
    ignored input."""
    from_user = (msg.get("from") or {}).get("id")
    chat_id = (msg.get("chat") or {}).get("id")
    text = msg.get("text") or msg.get("caption") or ""
    if not from_user or not chat_id:
        return None

    allowed = get_telegram_allowed_user()
    if not allowed:
        # First contact after token setup: lock the relay to this sender.
        set_telegram_allowed_user(int(from_user))
        await _tg(
            client, token, "sendMessage", chat_id=chat_id,
            text="🔒 Locked to you. Share a link here and openMemo saves it.",
        )
        allowed = int(from_user)
    if int(from_user) != allowed:
        log.warning("relay ignored message from foreign user id %s", from_user)
        return None

    m = _URL_RE.search(text)
    if not m:
        await _tg(
            client, token, "sendMessage", chat_id=chat_id,
            text="Send me a link and I'll save it to openMemo.",
        )
        return "chat"

    # \S+ grabs trailing prose punctuation ("…/p/XYZ/," ) — strip it so the
    # URL that reaches the pipeline is the URL the user meant.
    url = m.group(0).rstrip(".,;:!?)]}’”")
    result = await _save_url(url, settings.get("telegram_default_collection") or "IG Inbox")
    status = result.get("status")
    if status == "duplicate":
        await _tg(
            client, token, "sendMessage", chat_id=chat_id,
            text=f"Already saved ✓  ({result.get('title', '')[:60]})",
        )
    elif status == "error":
        await _tg(
            client, token, "sendMessage", chat_id=chat_id,
            text=f"⚠️ Save failed: {result.get('error', 'unknown error')}",
        )
    else:
        RELAY_STATUS["saved_count"] += 1
        buttons = await _collection_buttons(result["id"])
        await _tg(
            client, token, "sendMessage", chat_id=chat_id,
            text=f"Saved → {settings.get('telegram_default_collection') or 'IG Inbox'} ✓\n{result.get('title', '')[:80]}",
            reply_markup={"inline_keyboard": buttons} if buttons else None,
        )
    return "link"


async def _drain(client, token: str, settings: dict, timeout: int) -> bool:
    """One getUpdates call + processing. Returns True on any activity."""
    global _offset
    updates = await _tg(
        client, token, "getUpdates",
        offset=_offset, limit=100, timeout=timeout,
        allowed_updates=["message", "callback_query"],
    )
    if not updates:
        return False

    activity = False
    for i, u in enumerate(updates):
        _offset = max(_offset, u["update_id"] + 1)
        if u.get("callback_query"):
            await _handle_callback(client, token, u["callback_query"])
            activity = True
        elif u.get("message"):
            handled = await _handle_message(client, token, u["message"], settings)
            activity = activity or bool(handled)
            # Space out extractions inside a multi-link backlog (batch jitter):
            # only after an actual ingest, and only when more messages wait.
            remaining = any("message" in x for x in updates[i + 1:])
            if handled == "link" and remaining:
                await asyncio.sleep(random.uniform(*_BATCH_JITTER_S))
    return activity


async def run_relay_loop() -> None:
    """Forever loop, started from lifespan. Must never raise out."""
    global _offset
    RELAY_STATUS["running"] = True
    log.info("telegram relay loop started")
    while True:
        try:
            settings = get_settings()
            token = get_telegram_token()
            if not settings.get("telegram_enabled") or not token:
                await asyncio.sleep(30)
                continue

            minutes = settings.get("telegram_poll_minutes") or 15
            try:
                minutes = max(1, min(120, int(minutes)))
            except (TypeError, ValueError):
                minutes = 15

            async with httpx.AsyncClient(timeout=httpx.Timeout(_LONG_POLL_S + 10)) as client:
                activity = await _drain(client, token, settings, timeout=0)
                RELAY_STATUS["last_poll_at"] = datetime.utcnow().isoformat()
                RELAY_STATUS["last_error"] = None

                # Active window: stay responsive right after activity so button
                # taps and follow-up shares land instantly, then go quiet.
                window_left = _ACTIVE_WINDOW_S if activity else 0
                while window_left > 0:
                    if await _drain(client, token, settings, timeout=_LONG_POLL_S):
                        window_left = _ACTIVE_WINDOW_S
                    else:
                        window_left -= _LONG_POLL_S

            await asyncio.sleep(minutes * 60)
        except asyncio.CancelledError:
            RELAY_STATUS["running"] = False
            raise
        except Exception as e:
            RELAY_STATUS["last_error"] = str(e)[:200]
            log.error("telegram relay cycle failed: %r", e)
            await asyncio.sleep(60)
