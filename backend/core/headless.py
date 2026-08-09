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

Anti-detection layers (Cloudflare / Turnstile):
  1. patchright (patched Playwright fork) — removes CDP fingerprint markers from
     the Chromium binary itself; Turnstile's proof-of-work check passes without
     a CAPTCHA service. Drop-in API replacement for playwright.
  2. Stealth init script — patches navigator.webdriver, plugins, chrome.runtime,
     Notification.permission before any page JS runs (add_init_script).
  3. Cookie persistence — saves/loads cookies per domain so cf_clearance
     survives across requests; second visit is treated as a returning human.
  4. Human-like timing — random scroll + variable waits instead of a fixed delay.
  5. CF challenge detection — if the JS challenge is still running, waits an
     extra 6-9 s for it to self-resolve before reading the final DOM.
  6. Richer headers — sec-ch-ua client hints present in real Chrome. Sec-Fetch-*
     is left to Chromium: those values are per-request, and forcing navigation
     values onto subresources makes strict sites (Meta) serve an empty body.
"""
import asyncio
import json
import random
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Per-domain cookie jars: cf_clearance + session cookies persist across renders.
_COOKIE_DIR = Path(tempfile.gettempdir()) / "openmemo_cookies"

_pw = None
_browser = None
_lock = asyncio.Lock()
_unavailable = False  # latch: once Chromium fails to start, stop retrying

# Largest visible content image — unchanged from original.
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

# The slide currently ON STAGE: largest image by VISIBLE area. A carousel keeps
# every slide mounted at full size and just slides them out of view, so scoring
# by element size (as _LARGEST_IMAGE_JS does) returns slide 1 forever no matter
# how many times you press Next. Clipping the score to the viewport is what
# makes paging observable at all.
_STAGE_IMAGE_JS = """() => {
  let best = null, bestArea = 0;
  const W = window.innerWidth, H = window.innerHeight;
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) continue;
    if (r.width < 150 || r.height < 150) continue;
    const vw = Math.min(r.right, W) - Math.max(r.left, 0);
    const vh = Math.min(r.bottom, H) - Math.max(r.top, 0);
    if (vw <= 0 || vh <= 0) continue;      // mounted, but off stage
    const area = vw * vh;
    if (area > bestArea) { bestArea = area; best = src; }
  }
  return best;
}"""

# Slideshow paging: click the control the page labels "Next". Scraping every
# image on the page instead would not work — Instagram surrounds a post with a
# grid of OTHER posts at the same resolution, and nothing in a slide's URL says
# which post it belongs to. Advancing the stage is what distinguishes them.
# Label-driven, not class-driven: obfuscated class names change weekly, the
# accessibility label does not.
_NEXT_SLIDE_JS = """() => {
  const sels = [
    'button[aria-label="Next"]',
    'div[role="button"][aria-label="Next"]',
    '[aria-label="Next"]',
  ];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) { el.click(); return true; }
  }
  return false;
}"""

# IIFE injected via add_init_script — runs before any page JS so Cloudflare's
# synchronous fingerprint check sees patched values.
_STEALTH_JS = """(function () {
  // 1. webdriver flag — biggest giveaway; must be undefined, not false
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (_) {}

  // 2. Plugins — headless reports 0; real Chrome ships 5 built-in plugins
  try {
    const fakePlugins = [
      { name: 'Chrome PDF Plugin',      filename: 'internal-pdf-viewer',                     description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer',      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',        description: '' },
      { name: 'Native Client',          filename: 'internal-nacl-plugin',                    description: '' },
      { name: 'WebKit built-in PDF',    filename: 'webkit-pdf-plugin',                       description: '' },
      { name: 'Chromium PDF Viewer',    filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',        description: 'Portable Document Format' },
    ];
    const arr = fakePlugins.map(p => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperty(plugin, 'name',        { value: p.name });
      Object.defineProperty(plugin, 'filename',    { value: p.filename });
      Object.defineProperty(plugin, 'description', { value: p.description });
      Object.defineProperty(plugin, 'length',      { value: 0 });
      return plugin;
    });
    Object.defineProperty(arr, 'item',      { value: i => arr[i] });
    Object.defineProperty(arr, 'namedItem', { value: n => arr.find(p => p.name === n) || null });
    Object.defineProperty(navigator, 'plugins', { get: () => arr, configurable: true });
  } catch (_) {}

  // 3. Languages — headless may return [] or a single locale
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  } catch (_) {}

  // 4. chrome.runtime — absent in headless, present in every real Chrome tab
  if (!window.chrome)         window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};

  // 5. Notification.permission — headless defaults to 'denied'; real = 'default'
  try {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
    });
  } catch (_) {}

  // 6. userAgentData brands — strip 'HeadlessChrome' from the brands list
  try {
    if (navigator.userAgentData) {
      const brands = [
        { brand: 'Chromium',      version: '124' },
        { brand: 'Google Chrome', version: '124' },
        { brand: 'Not-A.Brand',   version: '99'  },
      ];
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands,
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: async () => ({
            architecture: 'x86', bitness: '64', brands,
            fullVersionList: [
              { brand: 'Chromium',      version: '124.0.0.0' },
              { brand: 'Google Chrome', version: '124.0.0.0' },
            ],
            mobile: false, model: '', platform: 'Windows',
            platformVersion: '10.0.0', uaFullVersion: '124.0.0.0',
          }),
          toJSON: () => ({ brands, mobile: false, platform: 'Windows' }),
        }),
        configurable: true,
      });
    }
  } catch (_) {}
})();"""

# Cloudflare challenge markers — if any appear in the initial DOM, the JS
# challenge is still running and we wait longer before reading the final HTML.
_CF_MARKERS = [
    "__cf_chl_opt",
    "cf-challenge-running",
    "cf-spinner",
    "Checking your browser",
    "jschl-answer",
]


async def _walk_slides(page, max_slides: int) -> list:
    """Page a slideshow and return each stage image in order.

    Reads the STAGE (largest rendered image) once per click rather than
    scraping every image on the page: a post's own slides and the unrelated
    grid of other posts around it are indistinguishable by URL, but only one
    of them is what you are looking at. Returns [] when there is nothing to
    page through, so a single-image page costs one evaluate."""
    slides: list = []
    try:
        first = await page.evaluate(_STAGE_IMAGE_JS)
    except Exception:
        return slides
    if not first:
        return slides
    slides.append(first)
    for _ in range(max_slides - 1):
        try:
            if not await page.evaluate(_NEXT_SLIDE_JS):
                break  # no Next control: nothing to page through
            await page.wait_for_timeout(900)
            nxt = await page.evaluate(_STAGE_IMAGE_JS)
        except Exception:
            break
        # A carousel wraps back to slide 1, and a stage mid-transition repeats
        # the current slide. Either way, a URL already held means we are done.
        if not nxt or nxt in slides:
            break
        slides.append(nxt)
    return slides


def _cookie_path(domain: str) -> Path:
    safe = domain.replace(":", "_").replace("/", "_")
    return _COOKIE_DIR / f"{safe}.json"


def _load_cookies(domain: str) -> list:
    p = _cookie_path(domain)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def _save_cookies(domain: str, cookies: list) -> None:
    try:
        _COOKIE_DIR.mkdir(parents=True, exist_ok=True)
        _cookie_path(domain).write_text(
            json.dumps(cookies, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


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
            from patchright.async_api import async_playwright

            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-infobars",
                    "--window-size=1280,800",
                    # Autoplay without a user gesture, so a player can start
                    # UNMUTED. Chromium's default policy only permits muted
                    # autoplay, and a muted DASH player never requests the audio
                    # representation at all — which is precisely why sniffed
                    # Instagram reels came back silent. See sniff_media.
                    "--autoplay-policy=no-user-gesture-required",
                ],
            )
            return _browser
        except Exception as e:
            print(f"[headless] Chromium unavailable, using plain-fetch fallback: {e}")
            _unavailable = True
            return None


async def render_page(
    url: str,
    *,
    timeout_ms: int = 45000,
    want_screenshot: bool = False,
    want_main_image: bool = False,
    want_gallery: bool = False,
    max_slides: int = 20,
) -> Optional[dict]:
    """Render `url` in a stealth browser, passing Cloudflare/JS challenges.

    Returns {"html": str, "screenshot": bytes|None, "main_image": str|None,
    "slides": list[str]} or None on failure. `main_image` is the largest
    rendered image — preferred on photo pages where og:image is a scraper
    placeholder.

    `want_gallery` pages a slideshow: read the stage, click Next, repeat.
    `slides` comes back empty on a page with nothing to page through, so a
    single-image page costs nothing extra. Reading the STAGE each step rather
    than scraping every image on the page is what keeps a post's own slides
    apart from the unrelated large images around it.
    """
    domain = urlparse(url).netloc.lstrip("www.")

    browser = await _ensure_browser()
    if browser is None:
        return None

    ctx = None
    try:
        saved_cookies = _load_cookies(domain)

        ctx = await browser.new_context(
            user_agent=_BROWSER_UA,
            viewport={"width": 1280, "height": 800},
            locale="en-US",
            timezone_id="America/New_York",
            # Client hints only. Sec-Fetch-* and Upgrade-Insecure-Requests are
            # deliberately NOT set here: extra_http_headers applies to EVERY
            # request (images, XHR, fetch), and pinning navigation values
            # ("dest: document", "site: none") onto subresource requests is an
            # invalid combination that Fetch Metadata resource-isolation
            # policies reject — Meta/Facebook returns an empty document body,
            # so the real photo never renders and main_image comes back None.
            # Chromium already sends the correct per-request Sec-Fetch-* values.
            extra_http_headers={
                "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
            },
        )

        # Stealth patches — must be installed on the context (applies to every
        # page opened from this context, before any page JS executes).
        await ctx.add_init_script(_STEALTH_JS)

        # Restore cookies from last successful visit — carries cf_clearance so
        # Cloudflare treats this as a returning human, not a cold new bot.
        if saved_cookies:
            try:
                await ctx.add_cookies(saved_cookies)
            except Exception:
                pass

        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

        # Page the slideshow FIRST, while the page is still interactive. Sites
        # that gate content (Instagram's login dialog) throw up a modal a few
        # seconds in that covers the slides and swallows the clicks, so the
        # settle-and-scroll sequence below has to happen after this, not before.
        slides: list = []
        if want_gallery:
            await page.wait_for_timeout(2500)
            slides = await _walk_slides(page, max_slides)

        # Wait for OG meta to appear (fast path when challenge already passed).
        try:
            await page.wait_for_selector(
                "meta[property='og:image'], meta[property='og:title']", timeout=10000
            )
        except Exception:
            pass

        # If a live CF challenge is detected, give the JS solver time to finish.
        html_check = await page.content()
        if any(m in html_check for m in _CF_MARKERS):
            wait_ms = random.randint(6000, 9000)
            print(f"[headless] CF challenge detected for {domain}, waiting {wait_ms}ms for JS resolve")
            await page.wait_for_timeout(wait_ms)

        # Network idle — let deferred assets and challenge redirects settle.
        try:
            await page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass

        # Human-like scroll: two small scroll steps with variable pauses.
        # Real users don't sit motionless for 1.2 s after load.
        await page.evaluate(f"window.scrollBy(0, {random.randint(80, 350)})")
        await page.wait_for_timeout(random.randint(400, 900))
        await page.evaluate(f"window.scrollBy(0, {random.randint(50, 200)})")
        await page.wait_for_timeout(random.randint(600, 1800))

        html = await page.content()

        # Persist cookies — saves cf_clearance for next request to this domain.
        try:
            cookies = await ctx.cookies()
            if cookies:
                _save_cookies(domain, cookies)
        except Exception:
            pass

        main_image = None
        if want_main_image or want_gallery:
            try:
                main_image = await page.evaluate(_LARGEST_IMAGE_JS)
            except Exception:
                main_image = None
        # The walk ran on the live, unobscured page — trust its first slide over
        # whatever the largest image is once the page has settled (a login modal
        # or a suggested-posts rail can easily be bigger than the post itself).
        if slides:
            main_image = slides[0]

        shot = (
            await page.screenshot(type="jpeg", quality=70, full_page=False)
            if want_screenshot
            else None
        )
        return {
            "html": html,
            "screenshot": shot,
            "main_image": main_image,
            "slides": slides,
        }

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
