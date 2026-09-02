"""Page-one covers for PDF memos (`core/pdf_thumb.py`).

The cover is best-effort by design: every caller treats a missing thumbnail as
"no thumb" and carries on, so the contract that actually matters is that this
never raises and never blocks. A PDF that will not render has to come back False
rather than take an ingest down with it, and the render has to happen off the
event loop, because PDFium is a blocking C library and this codebase has already
paid once for putting blocking work on the single loop.
"""
import asyncio
import time

import pytest

from backend.core.pdf_thumb import (
    MAX_HEIGHT,
    extract_pdf_thumbnail,
    pdfium_available,
)

pytestmark = pytest.mark.skipif(
    not pdfium_available(), reason="pypdfium2 not installed"
)


def _pdf_bytes(width: int = 595, height: int = 842, pages: int = 1) -> bytes:
    """A minimal, valid multi-page PDF with real text on every page.

    Written by hand rather than with a generator dependency: the fixture has to
    be deterministic, and the whole point is to exercise a real parse.
    """
    objs: dict[int, bytes] = {}
    first_page = 3
    first_content = first_page + pages
    font = first_content + pages

    kids = " ".join(f"{first_page + i} 0 R" for i in range(pages))
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objs[2] = f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode()

    for i in range(pages):
        objs[first_page + i] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
            f"/Resources << /Font << /F1 {font} 0 R >> >> "
            f"/Contents {first_content + i} 0 R >>"
        ).encode()
        stream = (
            f"BT /F1 24 Tf 50 {height - 80} Td (Page {i + 1}) Tj ET\n"
            f"0 0 0 rg 50 {height - 120} 200 4 re f"
        ).encode()
        objs[first_content + i] = (
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
        )

    objs[font] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for num in sorted(objs):
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + objs[num] + b"\nendobj\n"

    xref_at = len(out)
    count = max(objs) + 1
    out += b"xref\n0 %d\n" % count + b"0000000000 65535 f \n"
    for num in range(1, count):
        out += b"%010d 00000 n \n" % offsets[num]
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (count, xref_at)
    )
    return bytes(out)


@pytest.fixture
def a4(tmp_path):
    p = tmp_path / "doc.pdf"
    p.write_bytes(_pdf_bytes())
    return p


async def test_renders_page_one_at_the_requested_width(a4, tmp_path):
    from PIL import Image

    out = tmp_path / "cover.jpg"
    assert await extract_pdf_thumbnail(a4, out, width=480) is True
    assert out.stat().st_size > 0

    with Image.open(out) as im:
        assert im.format == "JPEG"
        assert im.width == 480
        # A4 is portrait, so the cover must be too. A square or landscape result
        # would mean the page geometry was ignored.
        assert im.height > im.width
        assert im.mode == "RGB"


async def test_renders_the_first_page_not_a_later_one(tmp_path):
    """Page one is the cover. A three-page document must not pick page three."""
    from PIL import Image

    src = tmp_path / "three.pdf"
    src.write_bytes(_pdf_bytes(pages=3))
    one = tmp_path / "one.jpg"
    assert await extract_pdf_thumbnail(src, one, width=200) is True

    # Same document rendered directly, page 0, is the reference.
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(src))
    try:
        ref = doc[0].render(scale=200 / float(doc[0].get_width())).to_pil().convert("RGB")
    finally:
        doc.close()

    with Image.open(one) as got:
        assert got.size == ref.size
        # JPEG is lossy, so compare coarsely: the ink is in the same places.
        got_px = got.convert("L").resize((32, 32))
        ref_px = ref.convert("L").resize((32, 32))
        diff = sum(
            abs(a - b) for a, b in zip(got_px.getdata(), ref_px.getdata())
        ) / (32 * 32)
        assert diff < 12, f"page one render drifted from the reference (mean {diff})"


async def test_a_very_tall_page_is_capped(tmp_path):
    """An A0 plan must not become a multi-thousand-pixel cover."""
    from PIL import Image

    src = tmp_path / "tall.pdf"
    src.write_bytes(_pdf_bytes(width=600, height=6000))
    out = tmp_path / "tall.jpg"
    assert await extract_pdf_thumbnail(src, out, width=480) is True

    with Image.open(out) as im:
        assert im.height <= MAX_HEIGHT
        # Capping height must not stretch the page.
        assert im.width < 480


async def test_creates_the_output_directory(a4, tmp_path):
    out = tmp_path / "does" / "not" / "exist" / "cover.jpg"
    assert await extract_pdf_thumbnail(a4, out) is True
    assert out.is_file()


@pytest.mark.parametrize(
    "name,payload",
    [
        ("garbage.pdf", b"this is not a pdf"),
        ("empty.pdf", b""),
        ("truncated.pdf", _pdf_bytes()[:120]),
    ],
)
async def test_unreadable_input_returns_false_without_raising(
    tmp_path, name, payload
):
    src = tmp_path / name
    src.write_bytes(payload)
    assert await extract_pdf_thumbnail(src, tmp_path / "x.jpg") is False


async def test_missing_file_returns_false(tmp_path):
    assert await extract_pdf_thumbnail(tmp_path / "nope.pdf", tmp_path / "x.jpg") is False


async def test_render_does_not_block_the_event_loop(tmp_path):
    """PDFium is blocking C. If it ran inline, every other request would wait.

    A wide, tall page gives the renderer real work to do; the loop must keep
    ticking throughout it.
    """
    src = tmp_path / "heavy.pdf"
    src.write_bytes(_pdf_bytes(width=1200, height=1600, pages=1))

    ticks = 0
    stop = False

    async def heartbeat():
        nonlocal ticks
        while not stop:
            ticks += 1
            await asyncio.sleep(0.001)

    beat = asyncio.create_task(heartbeat())
    started = time.perf_counter()
    ok = await extract_pdf_thumbnail(src, tmp_path / "heavy.jpg", width=1600)
    elapsed = time.perf_counter() - started
    stop = True
    await beat

    assert ok is True
    # Only meaningful if the render took long enough for the loop to have been
    # starved; on a very fast machine this is trivially satisfied either way.
    if elapsed > 0.05:
        assert ticks > 5, f"event loop starved during render ({ticks} ticks in {elapsed:.3f}s)"
