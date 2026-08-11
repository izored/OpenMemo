"""The picture invariant: openMemo never renders an image it does not own.

openMemo exists so that a saved thing survives its source. A card that fetches
its own thumbnail from `scontent-*.cdninstagram.com` every time you scroll past
it is not a saved thing. It is a live window onto someone else's server, and it
closes on their schedule, not yours. Six carousels proved the point in August
2026: they looked perfect for four days and were blank on the fifth, because
nothing behind them had ever been written to disk.

So the rule, and it has no exceptions for anything the eye lands on:

    A picture openMemo displays is a file on this machine.

Pictures are cheap enough that this costs nothing worth counting. A carousel is
a few hundred KB. The deliberate trade openMemo *does* make lives elsewhere and
stays there: a two-hour YouTube video with a working embed player is not
downloaded unless you ask, because a library of those fills a disk. That is
about heavy media, never about the picture on the card.

Two halves enforce it, and both are needed:

* Ingest downloads pictures BEFORE it commits (`localize_pictures_inline`), so
  the local path is what gets written in the first place.
* Serving strips any remote image URL that got in anyway (`serve_pictures`), so
  a row that slipped through renders a placeholder instead of quietly reaching
  out to the source. The URL stays in the database for the repair pass; it just
  never reaches a browser.

The second half is what makes this an invariant rather than an intention. Every
way a memo can fail to localize has now happened at least once: an unrouted
job, a silent download failure, a fire-and-forget task lost to a restart. The
serving layer does not care which one it was.
"""
from __future__ import annotations

from typing import Any


def is_remote(url: Any) -> bool:
    """A picture URL pointing at someone else's server."""
    return bool(url) and str(url).startswith(("http://", "https://"))


def is_picture_slide(slide: dict) -> bool:
    """A carousel slide that is a picture rather than a clip.

    A video slide is media, and media has its own rule: downloading it is the
    localize path's job, gated by `auto_download_video` because a library of
    long videos fills a disk. That is the one trade openMemo makes on purpose.
    Pictures get no such exemption.
    """
    return (slide.get("type") or "image") != "video"


def picture_urls(thumbnail_path: Any, gallery: Any) -> list[str]:
    """Every image URL a memo renders: its cover plus each picture slide."""
    urls: list[str] = []
    if thumbnail_path:
        urls.append(str(thumbnail_path))
    for slide in _slides(gallery):
        url = slide.get("url")
        if url and is_picture_slide(slide):
            urls.append(str(url))
    return urls


def _slides(gallery: Any) -> list[dict]:
    """Gallery as a list of dicts, whatever shape it arrived in.

    The ORM hands back a list; a raw SQL read hands back JSON text. Both happen,
    and a caller that only handles one silently sees an empty carousel.
    """
    if not gallery:
        return []
    if isinstance(gallery, (str, bytes)):
        import json

        try:
            gallery = json.loads(gallery)
        except (ValueError, TypeError):
            return []
    return [s for s in gallery or [] if isinstance(s, dict)]


def serve_pictures(payload: dict) -> dict:
    """Strip remote image URLs from an outgoing memo payload, in place.

    Called at every point a memo leaves the API. A cover we do not have becomes
    `null`, so the card falls back to its type placeholder rather than fetching
    from the source. Slides we do not have are dropped from the carousel.

    `pictures_pending` is set when anything was stripped, so the UI can say "the
    picture is still coming" instead of showing an unexplained blank — and so
    the state is visible rather than mysterious, which is how it went unnoticed
    for six days the first time.
    """
    pending = 0

    # The site icon is derived, never trusted from the row. 660 memos still
    # hold `google.com/s2/favicons?domain=…` from before icons were kept
    # locally, and rendering those means a request to Google per card on
    # screen. The domain is the only input that matters, and the answer is one
    # file per site (backend/core/favicons.py). A site we have no icon for
    # shows none, which is the honest version of "we do not have it".
    if "source_favicon" in payload or payload.get("source_domain"):
        from backend.core.favicons import ref_if_present

        payload["source_favicon"] = ref_if_present(payload.get("source_domain"))

    if is_remote(payload.get("thumbnail_path")):
        payload["thumbnail_path"] = None
        pending += 1

    gallery = payload.get("gallery")
    if gallery:
        slides = _slides(gallery)
        kept = [
            s for s in slides
            if not (is_picture_slide(s) and is_remote(s.get("url")))
        ]
        if len(kept) != len(slides):
            pending += len(slides) - len(kept)
            # A carousel stripped down to one slide is not a carousel. Leaving a
            # one-item gallery makes the detail page render swipe chrome around
            # a single picture.
            payload["gallery"] = kept if len(kept) > 1 else None

    if pending:
        payload["pictures_pending"] = pending
    return payload
