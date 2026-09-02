"""Render page one of a PDF into a JPEG cover.

A PDF memo used to get the same drawn placeholder as every other document: a
little stack of grey lines that says "this is a document" and nothing else. On a
wall of cards that makes every PDF identical, so finding the lease among nine
invoices meant reading nine titles. The first page of a PDF is usually the most
recognisable thing about it, so it becomes the card.

Rendered with pypdfium2: a permissively licensed wheel that bundles PDFium, so
there is no system package to install and nothing new in the Dockerfile. The
alternatives both cost more than they are worth here. pdf2image shells out to
poppler, which is a system dependency on every platform openMemo ships to, and
PyMuPDF is a much larger wheel.

Mirrors `core/video.py:extract_video_thumbnail` on purpose: same signature
shape, same "never raises" contract, same bool return. Every caller already
treats a missing thumbnail as "no thumb" and carries on, and a cover is never
worth failing an ingest over.

PDFium is a blocking C library, so the public entry point is async and hands the
work to a thread. Calling it inline would stall the single event loop for every
other request in flight, which is a mistake this codebase has already paid for
once (see the blocking-IO note in the memory index).
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Matches extract_video_thumbnail's default. Cards are at most ~320 CSS px wide,
# so 480 covers a 1.5x display without storing more than a cover needs.
DEFAULT_WIDTH = 480

# A page rendered above this many pixels tall is almost certainly a poster or a
# plan rather than a page, and the card only ever shows the top of it. Caps the
# work done for an A0 drawing.
MAX_HEIGHT = 1400


def pdfium_available() -> bool:
    """Is the renderer importable? False disables the feature, never breaks it."""
    try:
        import pypdfium2  # noqa: F401
    except Exception:
        return False
    return True


def _render(pdf_path: str, out_path: Path, width: int) -> bool:
    """The blocking half. Runs in a worker thread, never on the event loop."""
    import pypdfium2 as pdfium

    doc = None
    page = None
    try:
        doc = pdfium.PdfDocument(pdf_path)
        if len(doc) == 0:
            return False
        page = doc[0]

        # PDF user space is 72dpi, so scale is simply the pixel width we want
        # over the page's own point width.
        pt_width = float(page.get_width())
        pt_height = float(page.get_height())
        if pt_width <= 0 or pt_height <= 0:
            return False
        scale = width / pt_width
        if pt_height * scale > MAX_HEIGHT:
            scale = MAX_HEIGHT / pt_height

        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        # A PDF page is paper, so it has no alpha of its own, but a page with a
        # transparent background renders RGBA and JPEG cannot hold that. Compose
        # onto white rather than letting the alpha channel turn into black.
        if image.mode in ("RGBA", "LA", "P"):
            from PIL import Image

            image = image.convert("RGBA")
            flat = Image.new("RGB", image.size, (255, 255, 255))
            flat.paste(image, mask=image.split()[-1])
            image = flat
        elif image.mode != "RGB":
            image = image.convert("RGB")

        out_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(str(out_path), "JPEG", quality=82, optimize=True)
        return out_path.is_file() and out_path.stat().st_size > 0
    finally:
        # PDFium holds native handles. Closing is best effort: a page that never
        # opened has nothing to close, and failing to close must not turn a
        # rendered cover into a failed one.
        for handle in (page, doc):
            try:
                if handle is not None:
                    handle.close()
            except Exception:
                pass


async def extract_pdf_thumbnail(
    pdf_path: str | Path,
    out_path: str | Path,
    width: int = DEFAULT_WIDTH,
    timeout: float = 20.0,
) -> bool:
    """Render page one of `pdf_path` into `out_path` (JPEG).

    Returns True on success. Never raises: an encrypted PDF, a truncated one, a
    missing renderer and a page that will not draw all come back as False, and
    the memo simply keeps the drawn placeholder it has always had.
    """
    if not pdfium_available():
        return False

    src = Path(pdf_path)
    if not src.is_file():
        return False
    out = Path(out_path)

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_render, str(src), out, width), timeout=timeout
        )
    except asyncio.TimeoutError:
        log.warning("pdf thumbnail timed out after %ss: %s", timeout, src.name)
        return False
    except Exception as e:
        log.warning("pdf thumbnail failed for %s: %s", src.name, e)
        return False
