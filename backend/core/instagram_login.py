"""In-app Instagram login — the final-fallback session for IG pulls.

openMemo pulls mainly from Instagram, and IG now requires a login to read post
media. This module lets the user connect an Instagram session two ways:

  1. Session import — paste a Netscape cookies.txt exported from a browser you
     are already logged into. No password ever touches openMemo.
  2. Username + password — a headless browser logs in as you, captures the
     session cookies, and DISCARDS the password (never persisted, never logged).
     Convenience path; Instagram may answer with a checkpoint/2FA, which we
     surface instead of silently failing.

Both write the Instagram cookies into the SAME shared jar every resolver tier
reads (`DATA_DIR/yt_cookies.txt`, ADR-012) — so one login lights up the guest
media-info API, yt-dlp, gallery-dl and headless at once. Disconnect removes only
the Instagram cookies, leaving any other site's cookies intact.

Security invariants:
  • the password is only ever held in a local variable and passed to the login
    form; it is never written to disk, settings, or logs.
  • the session lives only under gitignored `data/` (the jar), never in git.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from backend.core.app_settings import get_cookies_path, cookies_present

log = logging.getLogger(__name__)

_IG_DOMAIN_MATCH = "instagram.com"
_NETSCAPE_HEADER = "# Netscape HTTP Cookie File\n"


# ── Netscape jar helpers (7 tab columns: domain flag path secure expiry name value) ──

def _read_jar_lines() -> list[str]:
    p = get_cookies_path()
    if not p.is_file():
        return []
    try:
        return p.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []


def _parse_line(line: str) -> tuple[str, str] | None:
    """Return (domain, name) key for a data line, else None (comment/blank)."""
    if not line or line.startswith("#"):
        return None
    parts = line.split("\t")
    if len(parts) >= 7:
        return parts[0], parts[5]
    return None


def _write_jar(lines: list[str]) -> None:
    """Atomically write the jar with the Netscape header + given data lines."""
    from backend.core.app_settings import save_cookies

    body = _NETSCAPE_HEADER + "\n".join(l for l in lines if l and not l.startswith("#"))
    save_cookies(body if body.endswith("\n") else body + "\n")


def _merge_into_jar(new_lines: list[str]) -> None:
    """Merge new cookie data lines into the existing jar, keyed by (domain,name)
    so re-importing refreshes a cookie instead of duplicating it."""
    existing = {_parse_line(l): l for l in _read_jar_lines() if _parse_line(l)}
    for l in new_lines:
        k = _parse_line(l)
        if k:
            existing[k] = l
    _write_jar(list(existing.values()))


def _has_ig_session() -> bool:
    """True when the jar holds an Instagram `sessionid` cookie."""
    for l in _read_jar_lines():
        k = _parse_line(l)
        if k and _IG_DOMAIN_MATCH in k[0] and k[1] == "sessionid":
            return True
    return False


def _ig_username_from_jar() -> str | None:
    """Best-effort display of who is connected — IG stores the numeric user id in
    `ds_user_id`; there's no username cookie, so we return that id as a hint."""
    for l in _read_jar_lines():
        k = _parse_line(l)
        if k and _IG_DOMAIN_MATCH in k[0] and k[1] == "ds_user_id":
            parts = l.split("\t")
            return f"id:{parts[6]}" if len(parts) >= 7 else None
    return None


def session_status() -> dict:
    """{connected: bool, who: str|None} for the Settings UI."""
    return {"connected": _has_ig_session(), "who": _ig_username_from_jar()}


def import_session_cookies(text: str) -> dict:
    """Merge a pasted Netscape cookies.txt (Instagram cookies) into the jar.
    Only lines whose domain is instagram.com are taken, so pasting a full export
    can't smuggle unrelated sites in through this endpoint."""
    ig_lines = [
        l for l in text.splitlines()
        if (_k := _parse_line(l)) and _IG_DOMAIN_MATCH in _k[0]
    ]
    if not ig_lines:
        return {"connected": _has_ig_session(), "error": "No Instagram cookies found in that file."}
    _merge_into_jar(ig_lines)
    return session_status()


def disconnect() -> dict:
    """Remove ONLY Instagram cookies from the shared jar (other sites stay)."""
    kept = [
        l for l in _read_jar_lines()
        if not ((_k := _parse_line(l)) and _IG_DOMAIN_MATCH in _k[0])
    ]
    data_kept = [l for l in kept if _parse_line(l)]
    if data_kept:
        _write_jar(data_kept)
    else:
        # Nothing else in the jar → remove it entirely.
        from backend.core.app_settings import delete_cookies
        delete_cookies()
    return session_status()


def _playwright_cookies_to_lines(cookies: list) -> list[str]:
    """Playwright cookie dicts → Netscape data lines (instagram.com only)."""
    out: list[str] = []
    for c in cookies:
        domain = c.get("domain") or ""
        if _IG_DOMAIN_MATCH not in domain:
            continue
        flag = "TRUE" if domain.startswith(".") else "FALSE"
        path = c.get("path") or "/"
        secure = "TRUE" if c.get("secure") else "FALSE"
        expiry = int(c.get("expires") or (time.time() + 60 * 60 * 24 * 365))
        if expiry < 0:
            expiry = int(time.time() + 60 * 60 * 24 * 365)
        name = c.get("name") or ""
        value = c.get("value") or ""
        if not name:
            continue
        out.append("\t".join([domain, flag, path, secure, str(expiry), name, value]))
    return out


async def login_with_password(username: str, password: str) -> dict:
    """Headless Instagram login. Captures the session into the jar; the password
    is never stored or logged. Returns a status dict:

      {"status": "ok", ...session_status()}    — logged in, session saved
      {"status": "two_factor"}                 — IG wants a 2FA code (unsupported
                                                 headlessly; use session import)
      {"status": "checkpoint"}                 — IG flagged the login (suspicious)
      {"status": "bad_credentials"}            — wrong username/password
      {"status": "unavailable"}                — headless browser not installed
                                                 (dev venv) — use session import

    NOTE: automating a password login can trip Instagram's anti-bot checkpoints
    on your MAIN account. Session import is the safer path — the UI says so.
    """
    if not username or not password:
        return {"status": "bad_credentials"}
    try:
        from patchright.async_api import async_playwright
    except Exception:
        return {"status": "unavailable"}

    pw = browser = ctx = None
    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        page = await ctx.new_page()
        await page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded", timeout=45000)
        try:
            await page.wait_for_selector("input[name='username']", timeout=15000)
        except Exception:
            return {"status": "unavailable"}
        await page.fill("input[name='username']", username)
        await page.fill("input[name='password']", password)
        await page.click("button[type='submit']")
        # Give IG a moment to set cookies or redirect to a challenge.
        await page.wait_for_timeout(6000)
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass

        cur = (page.url or "").lower()
        cookies = await ctx.cookies()
        names = {c.get("name") for c in cookies if _IG_DOMAIN_MATCH in (c.get("domain") or "")}

        if "sessionid" in names:
            _merge_into_jar(_playwright_cookies_to_lines(cookies))
            return {"status": "ok", **session_status()}
        if "two_factor" in cur or "2fa" in cur:
            return {"status": "two_factor"}
        if "challenge" in cur or "checkpoint" in cur:
            return {"status": "checkpoint"}
        # Look for the inline error IG shows on a bad password.
        body = (await page.content()).lower()
        if "incorrect" in body or "wasn't quite right" in body or "isn't right" in body:
            return {"status": "bad_credentials"}
        return {"status": "checkpoint"}
    except Exception as e:
        log.info("instagram headless login failed: %r", e)
        return {"status": "unavailable"}
    finally:
        # Never let the password linger; drop the reference explicitly.
        password = None  # noqa: F841
        for closer in (ctx, browser):
            try:
                if closer is not None:
                    await closer.close()
            except Exception:
                pass
        try:
            if pw is not None:
                await pw.stop()
        except Exception:
            pass
