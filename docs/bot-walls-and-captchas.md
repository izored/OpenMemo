# Sites that answer with a puzzle (Temu and friends)

Some sites will not serve a page to anything that is not a person clicking. Temu
is the loud example, but the same wall ships from DataDome, PerimeterX, GeeTest
and Akamai, and it turns up on marketplaces, ticket sites and price aggregators.
You have probably hit it yourself: slide the piece into the gap, rotate the
picture upright, press and hold.

openMemo cannot finish one of those. Nothing automated can, by design, which is
the entire point of the puzzle. This document is about what openMemo does
instead, and what actually works.

## What used to happen

Saving a Temu link produced a memo. It looked broken rather than blocked:

- title `Verify` or `Are you a robot?`
- the CAPTCHA's own artwork as the thumbnail
- a body of nothing

The extraction chain was working exactly as written. The wall is a real HTML
page, it parses, and it has an `og:image`. openMemo had no way to tell it apart
from a thin product page, so it filed it as one.

## What happens now

The wall is recognised, on both the plain-fetch path and the headless-browser
path, and the save short-circuits into an honest link card: the URL, the domain,
and a description saying the site asked for a human-verification puzzle and what
to do about it. The memo carries `resolve_tier = "blocked:bot-wall"`.

No fake title. No CAPTCHA artwork sitting in your library pretending to be a
product photo.

### How a wall is told apart from a page

Two conditions, both required:

1. **A marker.** One of a list of vendor fingerprints and puzzle strings
   (`px-captcha`, `captcha-delivery.com`, `geetest`, `datadome`, `slide to
   verify`, `press and hold`, `verify you are human`, Temu's own
   `anti_content`), matched case-insensitively.
2. **A near-empty document.** Under 120 KB of markup.

The second condition is what keeps the feature honest. Plenty of ordinary pages
load a captcha widget somewhere: a comment form, a signup box, a newsletter
footer. Writing those off as walls would silently downgrade a large slice of the
web. A real wall is a stub; a real page is not.

Both paths call the same function (`backend/core/headless.py`
`_looks_like_bot_wall`), so they can never disagree and bounce a URL between
them. Covered by `backend/tests/test_bot_wall_detection.py`.

## Temu specifically: most of it needs no browser at all

Probed against real saved links on 2026-08-29. A plain HTTP fetch of a Temu
**slug** product page (`temu.com/<region>/<slug>-g-<id>.html`) came back HTTP
200 with the full document, no puzzle, on 3 of 3 tried. The wall is not on every
request; it is rate and session dependent, and the page was reachable cold.

What was missing was never the page. It was the image:

- Temu sets `og:title`, `og:description`, `og:type=product` and `og:url`.
- Temu sets **no `og:image`**, and no JSON-LD.
- The hero photo is in the HTML anyway, as the preloaded LCP image:
  `<link rel="preload" as="image" fetchpriority="high" href="https://img.kwcdn.com/product/...">`
- That CDN URL fetches straight: HTTP 200, `image/webp`, 800x800, no challenge.

So the fix was a missing image rule, not a bot-wall problem. openMemo now falls
back to a page's preloaded hero whenever it publishes no `og:image`, preferring
`fetchpriority="high"` and then the widest variant when the CDN encodes a width.
The rule is host-agnostic, and it pays off on any client-rendered storefront
that renders its product shot in JavaScript.

### The one shape that still needs the extension

`temu.com/goods.html?goods_id=...` is a client-side router page. It carries no
`og:image`, no canonical pointing at the slug URL, no CDN image and sometimes no
`og:title` either. There is nothing server-side to read. Those links save as
bookmarks; use the extension if you want the content.

## What actually gets the page

### 1. The browser extension (this is the answer)

The extension reads the page out of **your own tab**, which is already past the
puzzle because you solved it. It sends the title, description, text and image
straight to your local backend. No fetch from the server, so no wall.

Solve the puzzle once in your browser, then click the extension. That is the
whole workflow, and it is the only one that reliably works on a site like Temu.

### 2. Your cookie jar

Settings has a **Cookies** upload (the one added for restricted downloads).
Since v3.14 the built-in headless browser uses it too, narrowed to the domain
being rendered. If a site's wall lifts for a signed-in session, exporting your
cookies once can get openMemo through it without you doing anything per-link.

It will not beat a puzzle that fires regardless of session. It will beat the
common case where the wall is really "we do not know who you are".

### 3. Save it as a plain link

The wall card is already this. If all you wanted was the bookmark, you have it,
and nothing further is needed.

## What openMemo will not do

It will not call a CAPTCHA-solving service. That means an API key, a per-solve
charge, your URLs leaving the machine, and a dependency on a third party for a
local-first app. The extension does the same job with none of that, using a page
you were already looking at.

## Anti-detection that IS in the box

For the layer of protection below an interactive puzzle, openMemo already runs a
real browser and a stack of countermeasures (see the module docstring in
`backend/core/headless.py`): patchright to strip CDP fingerprints, a stealth init
script, per-domain cookie persistence so `cf_clearance` survives, human-like
scroll timing, Cloudflare challenge detection with a longer wait, and real Chrome
client hints. That is enough for a Cloudflare JS challenge, which resolves
itself. It is not enough for a puzzle, and no amount of waiting makes it enough.
