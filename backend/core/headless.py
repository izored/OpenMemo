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
  7. The user's own cookie jar — the Netscape cookies.txt uploaded in Settings
     (shared with yt-dlp) is loaded for the domain being rendered. A site whose
     wall only lifts for a signed-in session (Temu, marketplaces) then renders
     for us exactly as it does in the user's browser.

What this deliberately does NOT do: solve a puzzle. Temu, DataDome, PerimeterX
and Akamai serve an interactive slider/rotate CAPTCHA that a real person has to
finish. Rather than saving that interstitial as if it were the page, a wall is
DETECTED and reported (`bot_wall`) so the caller can file the link honestly and
point the user at the browser extension, which reads the page out of their own
already-solved tab.
"""
import asyncio
import json
import random
import re
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
  const root = document.querySelector('[data-om-scope]') || document;
  for (const img of root.querySelectorAll('img')) {
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
  const root = document.querySelector('[data-om-scope]') || document;
  for (const img of root.querySelectorAll('img')) {
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
  const root = document.querySelector('[data-om-scope]') || document;
  for (const s of sels) {
    const el = root.querySelector(s);
    if (el) { el.click(); return true; }
  }
  return false;
}"""

# ---------------------------------------------------------------------------
# Post scoping. A permalink page is not just the post: Threads, Instagram and
# Reddit all wrap it in a feed of OTHER posts ("Related threads"), and every
# host-blind reader here - largest image, stage image, play-every-video - is
# happy to answer with a neighbour's media. That is exactly how a six-photo
# Threads carousel was saved as somebody else's video clip.
#
# The fix needs no per-site selectors. The post's own subtree is the LARGEST
# ancestor of its own permalink anchor that still links to no OTHER permalink
# of the same shape. Walk up from the anchor, stop at the first ancestor that
# pulls in a foreign permalink, and tag what is left as `data-om-scope`. Every
# reader below then works inside that tag when it exists.
_SCOPE_POST_JS = r"""([wantPrefix, kind]) => {
  const norm = (h) => {
    try { return new URL(h, location.origin).pathname.replace(/\/+$/, ''); }
    catch (_) { return ''; }
  };
  document.querySelectorAll('[data-om-scope]').forEach(
    (e) => e.removeAttribute('data-om-scope'));
  const want = (wantPrefix || '').replace(/\/+$/, '');
  if (!want || !kind) return false;
  // Ours: the permalink itself, and anything BELOW it. Reddit spells one post
  // as both /r/x/comments/abc and /r/x/comments/abc/a_long_title/, and a
  // comment deep-link sits below that again — all the same post, so the test
  // is a prefix, never string equality.
  const mine = (p) => p === want || p.startsWith(want + '/');
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  // A post links to itself from several places - the timestamp, a "Thread"
  // label, a view counter. Some of those sit in a tiny corner of the post, so
  // expanding the FIRST one found can scope to a two-word fragment. Expand
  // every self-link and keep the richest result.
  const selves = anchors.filter((a) => mine(norm(a.getAttribute('href'))));
  if (!selves.length) return false;
  // Somebody else's post: an anchor carrying the same kind token that is not
  // ours. `kind` comes from the URL, so nothing here knows which site it is on.
  const foreign = (el) => Array.from(el.querySelectorAll('a[href]')).some((a) => {
    const p = norm(a.getAttribute('href'));
    return p && !mine(p) && p.includes('/' + kind + '/');
  });
  let best = null, bestScore = -1;
  for (const self of selves) {
    let node = self, top = null;
    for (let i = 0; i < 24 && node.parentElement; i++) {
      node = node.parentElement;
      if (foreign(node)) break;
      top = node;
    }
    if (!top) continue;
    const media = Array.from(top.querySelectorAll('img, video')).filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width >= 120 && r.height >= 120;
    }).length;
    // Media count dominates; text length only breaks ties.
    const score = media * 1000 + Math.min((top.innerText || '').length, 999);
    if (score > bestScore) { bestScore = score; best = top; }
  }
  if (!best) return false;
  best.setAttribute('data-om-scope', '1');
  return true;
}"""

# Nudge every horizontal strip inside the scope through its full width. A
# carousel that mounts its slides lazily has nothing to read until the strip has
# been scrolled; one that mounts them all costs a few assignments.
_SCROLL_CAROUSEL_JS = """() => {
  const root = document.querySelector('[data-om-scope]');
  if (!root) return 0;
  const strips = Array.from(root.querySelectorAll('*')).filter(
    (e) => e.scrollWidth > e.clientWidth + 40 && e.clientWidth > 40);
  let steps = 0;
  for (const s of strips) {
    const stride = Math.max(80, s.clientWidth);
    for (let x = 0; x <= s.scrollWidth; x += stride) { s.scrollLeft = x; steps++; }
    s.scrollLeft = 0;
  }
  return steps;
}"""

# Every piece of media the scoped post owns, in document order, stills and
# clips together. A carousel is read by ENUMERATING the scope, not by pressing
# Next: Threads lays its slides out in a horizontal strip with no Next control
# at all, so the click-driven walk below sees exactly one slide and stops.
_SCOPE_MEDIA_JS = r"""() => {
  const root = document.querySelector('[data-om-scope]');
  if (!root) return [];
  // The widest entry in srcset, not currentSrc. A carousel slide renders at
  // thumbnail size, so currentSrc hands back the 320 px rendition while the
  // same element advertises the 3072 px original one attribute away. Saving
  // the thumbnail is how a "kept forever" copy quietly becomes unusable.
  const widest = (img) => {
    const ss = img.getAttribute('srcset') || '';
    let best = '', bestW = -1;
    for (const part of ss.split(/,(?=https?:)/)) {
      const bits = part.trim().split(/[ \t]+/);
      if (!bits[0]) continue;
      const w = parseInt((bits[1] || '').replace(/[^0-9]/g, ''), 10) || 0;
      if (w > bestW) { bestW = w; best = bits[0]; }
    }
    return best || img.currentSrc || img.src || '';
  };
  // Same photo, different rendition = different URL. Key on the CDN path so a
  // slide cannot land twice under two size params.
  const key = (u) => { try { return new URL(u, location.href).pathname; } catch (_) { return u; } };
  const seen = new Set(), out = [];
  for (const el of root.querySelectorAll('img, video')) {
    const r = el.getBoundingClientRect();
    // Avatars, reaction glyphs and spacer pixels. A slide is never this small.
    if (r.width < 120 || r.height < 120) continue;
    let u = '', type = 'image', poster = '';
    if (el.tagName === 'VIDEO') {
      // A player is a player before it has loaded. Facebook mounts <video>
      // with no src AND no poster until you press play, so typing the item
      // from its src made the post's own clip either a still or nothing at
      // all, and a shared video post came out as a bookmark. The ELEMENT is
      // the evidence; the URL is only how the card gets a picture. The
      // download path has always counted players this way (sniff_media's
      // probe counts <video> elements), and the two readers of one scope must
      // not disagree about what a player is.
      const src = el.currentSrc || el.src || '';
      poster = el.poster || '';
      u = src || poster;
      type = 'video';
    } else {
      u = widest(el);
      if (!u) continue;
    }
    if (u.startsWith('data:')) continue;
    // The photo's own page, when the grid links to it. Facebook serves the feed
    // a thumbnail of a much larger photo and SIGNS the size into the URL, so the
    // full one cannot be asked for by editing the query - every rewrite is a
    // 403. It is reachable only where Facebook already published it, which is
    // the permalink this thumbnail is wrapped in. Same-origin only, so a link
    // out of the post can never become the thing we fetch.
    let link = '';
    const a = el.closest('a[href]');
    if (a) {
      try {
        const abs = new URL(a.getAttribute('href'), location.href);
        if (abs.origin === location.origin) link = abs.href;
      } catch (_) {}
    }
    // A player with nothing to name yet still has to be told apart from the
    // next one, so it is keyed by position rather than by URL.
    const k = u ? key(u) : 'player:' + out.length;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ url: u, type: type, poster: poster, link: link });
  }
  return out;
}"""

# The full-size still on a photo's own page.
_FULL_IMAGE_JS = """() => {
  let best = null, bestArea = -1;
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || '';
    if (!src || src.startsWith('data:')) continue;
    // NATURAL pixels, not rendered ones. The viewer scales the photo down to
    // the window; what we are here for is the file behind it.
    const area = img.naturalWidth * img.naturalHeight;
    if (area > bestArea) { bestArea = area; best = {url: src, w: img.naturalWidth, h: img.naturalHeight}; }
  }
  return best;
}"""

# The scoped post's own text - author line, caption, counters. Read instead of
# the whole document so a neighbour's caption can never become this memo's.
_SCOPE_TEXT_JS = """() => {
  const root = document.querySelector('[data-om-scope]');
  return root ? (root.innerText || '').trim() : '';
}"""

# Cookie-consent interstitial. DECLINE only - the optional-cookie buttons are
# listed in preference order and "Allow all" is deliberately absent, so the
# worst this can do is refuse tracking on the user's behalf. Meta serves this
# screen INSTEAD of the post to a cold browser profile, which is how a Threads
# memo came to hold Meta's cookie policy as its content.
_DISMISS_CONSENT_JS = """() => {
  const wanted = [
    'decline optional cookies',
    'only allow essential cookies',
    'allow essential cookies',
    'essential cookies only',
    'necessary cookies only',
    'reject optional cookies',
    'reject non-essential',
    'reject all',
    'decline all',
  ];
  const nodes = Array.from(
    document.querySelectorAll('button, [role="button"], a[role="link"], a'));
  for (const want of wanted) {
    for (const el of nodes) {
      const label = (el.innerText || el.getAttribute('aria-label') || '')
        .trim().toLowerCase();
      if (label && label.includes(want)) {
        try { el.click(); return want; } catch (_) {}
      }
    }
  }
  return '';
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

# Interactive anti-bot walls — a puzzle a HUMAN has to finish (slide the piece,
# rotate the image, press and hold). Unlike a Cloudflare JS challenge these do
# not self-resolve no matter how long we wait, so detecting one is the whole
# point: it turns "openMemo saved a memo titled 'Verify'" into "openMemo says
# this site wants a puzzle, save it with the extension instead".
# Matched case-insensitively against the settled DOM.
_BOT_WALL_MARKERS = [
    # Temu / Akamai / generic slider + rotate puzzles
    "px-captcha",
    "slidercaptcha",
    "slide to verify",
    "drag the slider",
    "rotate the image",
    "press &amp; hold",
    "press and hold",
    "verify you are human",
    "verify you are a human",
    "are you a robot",
    "please verify to continue",
    "unusual traffic from your",
    # Vendor fingerprints
    "datadome",
    "captcha-delivery.com",
    "perimeterx",
    "_px_captcha",
    "geetest",
    "hcaptcha",
    "/akam/",
    "aka-cdn",
    # Temu's own wall
    "anti_content",
    "verification-page",
]


def _looks_like_bot_wall(html: str) -> bool:
    """True when the settled DOM is an interactive human-verification puzzle.

    Deliberately requires the page to ALSO be content-thin: an ordinary product
    page that merely loads hCaptcha for its review form would otherwise be
    written off as a wall. A real wall is a near-empty document."""
    if not html:
        return False
    low = html.lower()
    if not any(m in low for m in _BOT_WALL_MARKERS):
        return False
    # A wall is a stub. 120 KB of markup means the real page rendered and the
    # marker came from a widget somewhere on it.
    return len(html) < 120_000


# Cookie-consent interstitial. Meta serves this screen INSTEAD of a Threads or
# Instagram post to a cold browser profile: the DOM parses beautifully, into a
# memo whose body is Meta's cookie policy and whose "content" is a list of
# Learn more links. Verified on a live Threads carousel 2026-09-01.
#
# Two marker classes, both required. A page that DESCRIBES cookies (a real
# cookie policy, a privacy page) trips the descriptive list only; an actual
# consent gate also carries its own decision buttons in the body text.
_CONSENT_ACTION_MARKERS = [
    "decline optional cookies",
    "allow all cookies",
    "accept all cookies",
    "reject all cookies",
    "only allow essential cookies",
    "allow essential cookies",
    "manage cookie preferences",
    "decline optional",
]
_CONSENT_TOPIC_MARKERS = [
    "allow the use of cookies",
    "we use cookies and similar technologies",
    "your cookie choices",
    "cookies from other companies",
    "about cookies",
    "why do we use cookies",
]


def _looks_like_consent_wall(text: str) -> bool:
    """True when this text is a cookie-consent gate rather than the page.

    Reads the EXTRACTED TEXT, not the raw HTML: a consent screen on a
    client-rendered site ships megabytes of bundle around a few hundred words
    of policy, so the size test that catches a bot wall says nothing here. What
    identifies it is the pairing - the copy explains cookies AND the body
    carries its own accept/decline buttons - inside a document far too short to
    be the article it is standing in front of."""
    if not text:
        return False
    low = text.lower()
    if len(low) > 15000:
        return False
    if not any(m in low for m in _CONSENT_ACTION_MARKERS):
        return False
    return any(m in low for m in _CONSENT_TOPIC_MARKERS)


async def _dismiss_consent(page) -> str:
    """Click a consent dialog's DECLINE control, if one is on the page.

    Returns the label matched, or "". Never accepts: the button list is
    decline-only by construction, so the page either continues with optional
    cookies refused or is left exactly as it was."""
    try:
        clicked = await page.evaluate(_DISMISS_CONSENT_JS)
    except Exception:
        return ""
    if clicked:
        try:
            await page.wait_for_timeout(1200)
        except Exception:
            pass
    return clicked or ""


def _netscape_cookies_for(domain: str) -> list:
    """The user's uploaded cookies.txt, narrowed to `domain`, as Playwright dicts.

    Same jar yt-dlp uses (Settings -> Cookies), so one upload serves downloads
    AND rendering. Silent no-op when no jar exists; a malformed line is skipped
    rather than failing the render."""
    try:
        from backend.core.app_settings import cookies_present, get_cookies_path

        if not cookies_present():
            return []
        raw = get_cookies_path().read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    host = domain.lstrip(".")
    # "shop.temu.com" should also pick up cookies scoped to ".temu.com".
    parts = host.split(".")
    suffixes = {host} | {".".join(parts[i:]) for i in range(len(parts) - 1)}

    out: list = []
    for line in raw.splitlines():
        # rstrip, never strip: a trailing TAB is a real field (a cookie with an
        # empty value), and stripping it drops the line to six fields and
        # silently discards the cookie.
        line = line.rstrip("\r\n")
        if not line.strip():
            continue
        # Every exporter writes httpOnly cookies as `#HttpOnly_<domain>\t...`,
        # which is a DATA line wearing a comment's clothes. Skipping it as a
        # comment throws away exactly the cookies that matter here: a login
        # session is httpOnly almost by definition.
        http_only = False
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
            http_only = True
        elif line.lstrip().startswith("#"):
            continue
        f = line.split("\t")
        if len(f) < 7:
            continue
        cdomain, _flag, path, secure, expires, name, value = f[:7]
        bare = cdomain.strip().lstrip(".")
        if bare not in suffixes:
            continue
        try:
            exp = int(expires)
        except ValueError:
            exp = 0
        out.append({
            "name": name,
            "value": value,
            "domain": cdomain.strip(),
            "path": path or "/",
            "secure": secure.strip().upper() == "TRUE",
            "httpOnly": http_only,
            # 0 in a Netscape jar means "session cookie"; Playwright wants -1.
            "expires": exp if exp > 0 else -1,
        })
    return out


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


async def _scope_post(page, permalink: str) -> bool:
    """Tag the subtree belonging to `permalink` as `data-om-scope`, if found.

    The URL shapes live in `core/permalinks` so no reader here parses one. A URL
    that is not a post permalink scopes nothing and the page is read whole,
    which is the old behaviour and the safe way to fail."""
    from backend.core.permalinks import post_scope

    scope = post_scope(permalink)
    if not scope:
        return False
    try:
        return bool(
            await page.evaluate(_SCOPE_POST_JS, [scope["prefix"], scope["kind"]])
        )
    except Exception:
        return False


def _landed_rescope(scope_permalink: str, landed: str) -> str | None:
    """The URL to try scoping from when `scope_permalink` scoped nothing.

    A share-sheet link is a redirect wrapper, not a permalink the page has ever
    heard of. `facebook.com/share/p/<code>` names the post but appears nowhere
    inside it, so the scope pass finds no self-link, narrows to nothing, and the
    post is then read as the feed wrapped around it — which is how a four-photo
    album came to be saved as a video. Facebook offers no other link for such a
    post: its Share menu has no copy-link entry, so this wrapper is the shape
    these memos arrive in.

    The URL the browser LANDED on is the real permalink, in the same spelling
    the page's own anchors use. Host-blind, like everything else here: returns
    None when nothing redirected, or when what we landed on is not a permalink
    either, so the retry costs one string compare on the common path."""
    from backend.core.permalinks import post_scope

    landed = (landed or "").strip()
    if not landed or landed.rstrip("/") == (scope_permalink or "").rstrip("/"):
        return None
    return landed if post_scope(landed) else None


async def _collect_post_media(page, max_slides: int) -> list:
    """Every still and clip the scoped post owns, in document order.

    Enumeration, not paging. A Threads carousel has no Next control at all - it
    is a horizontal strip with all six slides mounted side by side - so the
    click-driven walk reads one slide and calls it a single-image post. Scroll
    each strip through its width first, in case the slides mount lazily, then
    read what the scope holds."""
    try:
        await page.evaluate(_SCROLL_CAROUSEL_JS)
        await page.wait_for_timeout(900)
    except Exception:
        pass
    try:
        items = await page.evaluate(_SCOPE_MEDIA_JS) or []
    except Exception:
        return []
    # A player that has not loaded names no URL yet and is still the strongest
    # thing the post holds, so it is kept and classify_media sees a video where
    # there is one. A still with no URL is nothing at all.
    return [
        i for i in items
        if isinstance(i, dict) and (i.get("url") or i.get("type") == "video")
    ][:max_slides]


# A CDN URL that names both the biggest rendition it HAS and the one it is
# SERVING. Facebook writes them as `cstp=mx2000x2000` (max) and `ctp=s590x590`
# (served) on the same URL, so a feed thumbnail carries a receipt for the 2000px
# original sitting behind it. Both numbers are inside the signature: editing
# either one returns 403, verified 2026-09-04 against a live photo, so knowing
# the big one exists is not the same as being able to ask for it.
_CDN_MAX_RE = re.compile(r"[?&]cstp=[a-z]*(\d+)x(\d+)", re.I)
_CDN_SERVED_RE = re.compile(r"[?&]ctp=[a-z]*(\d+)x(\d+)", re.I)


def _served_pixels(url: str) -> int:
    """Pixel count the URL says it is serving, or 0 when it does not say."""
    m = _CDN_SERVED_RE.search(url or "")
    return int(m.group(1)) * int(m.group(2)) if m else 0


def _underserved(url: str) -> bool:
    """True when the URL advertises a materially bigger rendition than it serves.

    The gate on following a photo's permalink, so the extra page load is only
    paid where there is something to gain. A host that already handed over its
    best - anything with a `srcset`, which `widest` reads - says nothing here and
    costs nothing. The threshold is 1.5x on the long edge: chasing a 10% bigger
    file across a page load is not worth the second it takes."""
    mx = _CDN_MAX_RE.search(url or "")
    sv = _CDN_SERVED_RE.search(url or "")
    if not mx or not sv:
        return False
    biggest = max(int(mx.group(1)), int(mx.group(2)))
    serving = max(int(sv.group(1)), int(sv.group(2)))
    return serving > 0 and biggest >= serving * 1.5


async def _upgrade_stills(context, media: list, *, max_upgrades: int = 12,
                          timeout_ms: int = 20000) -> list:
    """Replace thumbnail stills with the full-size file, via each photo's own page.

    A four-photo Facebook album saved as four 590x590 JPEGs of about 26KB while
    the post held 2000x2000 originals of about 215KB - eleven times the pixels,
    thrown away at save time and unrecoverable later, because the CDN URL expires.
    "Kept forever" has to mean the photo, not a preview of it.

    The grid links each thumbnail to its photo page and that page serves the full
    rendition, so this walks the links rather than guessing at URLs. One reused
    tab, in order, only for stills that `_underserved` flags, capped. Every step
    fails soft: a photo page that will not load, or that turns out to hold nothing
    bigger, leaves the thumbnail exactly as it was."""
    targets = [
        (i, m) for i, m in enumerate(media or [])
        if (m or {}).get("type") != "video"
        and (m or {}).get("link")
        and _underserved((m or {}).get("url") or "")
    ][:max_upgrades]
    if not targets:
        return media

    page = None
    upgraded = 0
    try:
        page = await context.new_page()
        for i, m in targets:
            try:
                await page.goto(m["link"], wait_until="domcontentloaded",
                                timeout=timeout_ms)
                await _dismiss_consent(page)
                await page.wait_for_timeout(1500)
                full = await page.evaluate(_FULL_IMAGE_JS)
            except Exception:
                continue
            if not full or not full.get("url"):
                continue
            # Only take it when it really is bigger. The photo page can serve the
            # same rendition the grid did, and a swap that gains nothing still
            # costs a URL that expires on a different clock.
            gained = int(full.get("w") or 0) * int(full.get("h") or 0)
            if gained <= _served_pixels(m.get("url") or ""):
                continue
            media[i] = {**m, "url": full["url"]}
            upgraded += 1
    except Exception:
        pass
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
    if upgraded:
        print(f"[headless] upgraded {upgraded} still(s) to the full-size original")
    return media


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
    scope_permalink: str | None = None,
) -> Optional[dict]:
    """Render `url` in a stealth browser, passing Cloudflare/JS challenges.

    Returns {"html": str, "screenshot": bytes|None, "main_image": str|None,
    "slides": list[str], "bot_wall": bool} or None on failure. `bot_wall` is
    True when the settled DOM is an interactive human-verification puzzle
    (Temu, DataDome, PerimeterX): the HTML is real, but it is the wall, not the
    page, and no amount of waiting changes that. `main_image` is the largest
    rendered image — preferred on photo pages where og:image is a scraper
    placeholder.

    `want_gallery` pages a slideshow: read the stage, click Next, repeat.
    `slides` comes back empty on a page with nothing to page through, so a
    single-image page costs nothing extra. Reading the STAGE each step rather
    than scraping every image on the page is what keeps a post's own slides
    apart from the unrelated large images around it.

    `scope_permalink` narrows EVERYTHING to the post that permalink names -
    slides, largest image, and the text - by tagging its subtree before any
    reader runs. A permalink page is a post surrounded by a feed of other
    posts, and without this the readers here answer with whatever neighbour
    happened to be biggest. It also switches the gallery from click-to-page to
    enumerate-the-scope, which is the only thing that reads a carousel laid out
    as a horizontal strip. Adds `post_media` (ordered {url,type,poster} for the
    post's own stills and clips), `post_text`, and `scoped`. A permalink that is
    really a redirect wrapper - a share-sheet link, which is the only link
    Facebook offers for a multi-photo post - names nothing the page carries, so
    the scope is retried from the URL the browser landed on (`_landed_rescope`).

    `consent_wall` is True when the settled DOM is a cookie-consent gate rather
    than the page. A decline control is clicked first, so this only stays True
    when the gate had no decline path we could take.
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

        # The user's own jar (Settings -> Cookies) last, so a real signed-in
        # session wins over whatever we cached ourselves. This is what gets a
        # session-gated marketplace to render for us at all.
        user_cookies = _netscape_cookies_for(domain)
        if user_cookies:
            try:
                await ctx.add_cookies(user_cookies)
            except Exception:
                pass

        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

        # A consent gate is served INSTEAD of the page, so it has to go before
        # anything reads the DOM. Decline-only, host-agnostic, no-op when there
        # is no dialog.
        consent_dismissed = await _dismiss_consent(page)

        # Narrow to the post before any reader runs. Everything below - the
        # slides, the largest image, the text - then describes THIS post rather
        # than the feed of other posts wrapped around it.
        scoped = False
        post_media: list = []
        post_text = ""

        # Page the slideshow FIRST, while the page is still interactive. Sites
        # that gate content (Instagram's login dialog) throw up a modal a few
        # seconds in that covers the slides and swallows the clicks, so the
        # settle-and-scroll sequence below has to happen after this, not before.
        slides: list = []
        if want_gallery or scope_permalink:
            await page.wait_for_timeout(2500)
            if scope_permalink:
                scoped = await _scope_post(page, scope_permalink)
                if not scoped:
                    retry = _landed_rescope(scope_permalink, page.url or "")
                    if retry:
                        scoped = await _scope_post(page, retry)
                if scoped:
                    post_media = await _collect_post_media(page, max_slides)
                    # The grid hands over thumbnails. Trade a few page loads for
                    # the originals before anything downstream saves them.
                    post_media = await _upgrade_stills(ctx, post_media)
                    try:
                        post_text = await page.evaluate(_SCOPE_TEXT_JS) or ""
                    except Exception:
                        post_text = ""
            # Enumerating the scope already answered the question; only fall
            # back to clicking Next when it did not (no scope, or an empty one).
            if want_gallery and not post_media:
                slides = await _walk_slides(page, max_slides)
        if post_media:
            slides = [m["url"] for m in post_media if m.get("type") == "image"]

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

        # An interactive puzzle never self-resolves. Say so instead of handing
        # back the interstitial as if it were the page.
        bot_wall = _looks_like_bot_wall(html)
        if bot_wall:
            print(f"[headless] interactive bot wall on {domain} — no automated pass")

        # A consent gate that survived the decline click. Read from the RENDERED
        # text, because the gate ships the site's whole JS bundle around a few
        # hundred words of cookie policy and no size test can see that.
        consent_wall = False
        try:
            body_text = await page.evaluate("() => document.body ? document.body.innerText : ''")
        except Exception:
            body_text = ""
        if _looks_like_consent_wall(body_text or ""):
            consent_wall = True
            print(f"[headless] cookie-consent gate still up on {domain}")

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
            "bot_wall": bot_wall,
            "consent_wall": consent_wall,
            "consent_dismissed": consent_dismissed,
            "scoped": scoped,
            "post_media": post_media,
            "post_text": post_text,
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
