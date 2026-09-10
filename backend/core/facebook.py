"""What a Facebook post holds, read from the page payload instead of the DOM.

Every other network in openMemo is read by scoping the rendered DOM to the
post's own subtree (`core/permalinks` + `headless._scope_post`). Facebook group
posts defeat that, and it took five identical bug reports to see why:

  * The browser is logged out, so `facebook.com/groups/<g>/posts/<id>` renders a
    login wall. Measured live on 2026-09-10: 13 anchors, 511 characters of body
    text, ZERO anchors containing `/posts/`, unchanged over a 12-second poll.
    There is no post subtree to narrow to, so the scope pass can only fail, and
    a failed scope falls back to `classify_media(..., fallback="video")`.
  * `og:type` on that same post, served to a link-preview crawler with no wall
    at all, is `video.other`. For a four-photo album with no video anywhere on
    it. The one metadata field that claims to answer this question is wrong.
  * `og:image` is a single image, by specification, so it can never reveal that
    the post is an album.

What IS reliable is the JSON payload Facebook ships inside that walled page. It
carries the post's photo set in full, as links of the shape

    /photo/?fbid=<photo id>&set=pcb.<post id>

where `pcb.<post id>` names THIS post. That anchoring is what makes it safe: a
neighbouring post's photos carry a different set id and are ignored, which is
the same guarantee the DOM scope was there to provide.

Each photo id resolves to a full-size JPEG through the crawler media endpoint,
with the link-preview UA and no session — 300-500 KB apiece on the album that
prompted this.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

# The post's numeric id, in the spellings a Facebook permalink uses.
_POST_ID_RE = re.compile(
    r"/(?:posts|videos|permalink|photos)/(?:pcb\.)?(\d{6,})", re.I
)

# Full-size image for a photo id. Answers with the picture only to a
# link-preview UA (`extractor._CRAWLER_UA`); a browser UA gets a login page.
MEDIA_URL = "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id={}"


def post_id(url: str) -> str | None:
    """The numeric id of the post `url` names, or None."""
    try:
        parts = urlparse(url or "")
    except Exception:
        return None
    m = _POST_ID_RE.search(parts.path or "")
    if m:
        return m.group(1)
    # `/permalink.php?story_fbid=<id>&id=<page>` and the `photo.php` spellings.
    for key in ("story_fbid", "set", "fbid"):
        for raw in parse_qs(parts.query or "").get(key, []):
            m = re.search(r"(\d{6,})", raw or "")
            if m:
                return m.group(1)
    return None


def album_photos(html: str, url: str, *, limit: int = 30) -> list[dict]:
    """Every photo THIS post owns, in page order, as `core/social` media items.

    Empty for a post that names no photo set, for a URL that is not a post, and
    for any html that does not carry the payload — so a caller that adds this
    behaves exactly as it did before whenever it cannot help.
    """
    pid = post_id(url)
    if not pid or not html:
        return []
    # `&`, `&amp;` and the `\u0026` the JSON payload escapes it as.
    amp = r"(?:&|&amp;|\u0026)"
    pattern = re.compile(
        r"/photo/\?fbid=(\d{6,})" + amp + r"set=(?:pcb|a|gm|p)\." + re.escape(pid),
        re.I,
    )
    seen: list[str] = []
    for fbid in pattern.findall(html):
        if fbid not in seen:
            seen.append(fbid)
        if len(seen) >= limit:
            break
    return [{"url": MEDIA_URL.format(f), "type": "image"} for f in seen]
