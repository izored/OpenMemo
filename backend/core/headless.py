"""Self-hosted headless-browser fetch — the local, open-source replacement for
Microlink.

A plain HTTP fetch of an antibot-protected page (Dribbble, Behance, many SPAs)
returns a Cloudflare *challenge stub* (HTTP 202 + a tiny JS shell, no OpenGraph).
Microlink solved this server-side with a real browser + proxies, then paywalled
antibot sites (`EPROXYNEEDED`). This runs our own Chromium via Playwright so the
challenge JS executes and the page renders fully — exposing the real og:image +
content — with no third-party API and no paid plan. The browser ships in the
image, so it works on every install.

Lazy singleton: Chromium launches on first use and stays warm; each render gets
its own incognito context. If Playwright or the browser binary is unavailable,
every call returns None so the caller degrades to the plain-HTTP path instead of
erroring — the feature is purely additive.
"""
import asyncio
from typing import Optional

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_pw = None
_browser = None
_lock = asyncio.Lock()
_unavailable = False  # latch: once Chromium fails to start, stop retrying

# Largest visible content image (by rendered area), skipping icons / spacers /
# data URIs. On a photo page (Facebook/Instagram/X photo, …) the real subject is
# this rendered image, while the platform serves a generic placeholder in
# og:image to scrapers — so callers prefer this for image-type URLs.
_LARGEST_IMAGE_JS = """() => {
  let best = null, bestArea = 0;
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) continue;
    if (r.width < 150 || r.height < 150) continue;
    const area = r.width * r.height;
    if (area > bestArea) { bestArea = area; best = src; }
  }
  return best;
}"""


async def _ensure_browser():
    """Return a connected Chromium, launching it once. None if unavailable."""
    global _pw, _browser, _unavailable
    if _unavailable:
        return None
    if _browser is not None and _browser.is_connected():
        return _browser
    async with _lock:
        if _browser is not None and _browser.is_connected():
            return _browser
        try:
            from playwright.async_api import async_playwright

            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            return _browser
        except Exception as e:  # binary missing, sandbox, OOM…
            print(f"[headless] Chromium unavailable, using plain-fetch fallback: {e}")
            _unavailable = True
            return None


async def render_page(
    url: str,
    *,
    timeout_ms: int = 35000,
    want_screenshot: bool = False,
    want_main_image: bool = False,
) -> Optional[dict]:
    """Render `url` in a real browser, waiting for any Cloudflare/JS challenge to
    resolve. Returns {"html": str, "screenshot": bytes|None, "main_image": str|None}
    or None on failure. `main_image` (when requested) is the largest rendered
    image — the real subject on photo pages where og:image is a placeholder.
    """
    browser = await _ensure_browser()
    if browser is None:
        return None
    ctx = None
    try:
        ctx = await browser.new_context(
            user_agent=_BROWSER_UA,
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # A managed challenge swaps the stub for the real DOM once its JS runs;
        # wait for OpenGraph meta to appear, then for the network to settle.
        try:
            await page.wait_for_selector(
                "meta[property='og:image'], meta[property='og:title']", timeout=12000
            )
        except Exception:
            pass
        try:
            await page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass
        await page.wait_for_timeout(1200)
        html = await page.content()
        main_image = None
        if want_main_image:
            try:
                main_image = await page.evaluate(_LARGEST_IMAGE_JS)
            except Exception:
                main_image = None
        shot = (
            await page.screenshot(type="jpeg", quality=70, full_page=False)
            if want_screenshot
            else None
        )
        return {"html": html, "screenshot": shot, "main_image": main_image}
    except Exception as e:
        print(f"[headless] render failed for {url}: {e}")
        return None
    finally:
        if ctx is not None:
            try:
                await ctx.close()
            except Exception:
                pass


async def close_browser():
    """Shut the shared browser down (call from app lifespan)."""
    global _pw, _browser
    try:
        if _browser is not None:
            await _browser.close()
    except Exception:
        pass
    try:
        if _pw is not None:
            await _pw.stop()
    except Exception:
        pass
    _browser = None
    _pw = None
