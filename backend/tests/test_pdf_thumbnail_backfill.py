"""`POST /api/maintenance/backfill-pdf-thumbs`.

The viewer needs no backfill: it draws from the file on disk when you open the
memo. A cover does, because it is a real JPEG that has to exist before a card
can point at it, so every PDF saved before covers shipped keeps the drawn
placeholder until this route runs.

Two things here are easy to get wrong and both would silently skip real memos.
Selection is by file EXTENSION, not by `Memo.type`, because .pdf, .docx and
.epub all categorize as "document" and only the first can be rasterized. And it
crosses every workspace, because Spaces hold memos too (ADR-020 scopes ordinary
reads to one workspace; a maintenance sweep is not one of those reads).
"""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.core.pdf_thumb import pdfium_available
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo
from backend.tests.test_pdf_thumbnail import _pdf_bytes

pytestmark = pytest.mark.skipif(
    not pdfium_available(), reason="pypdfium2 not installed"
)


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_slate(client):
    """Each test owns the memo table and the thumbs dir it asserts against.

    Takes `client` so the app's startup has created the tables before this
    tries to empty them. An autouse fixture otherwise runs first and finds no
    schema at all.
    """
    async def _wipe():
        from sqlalchemy import delete

        async with AsyncSessionLocal() as db:
            await db.execute(delete(Memo))
            await db.commit()

    asyncio.run(_wipe())
    thumbs = settings.FILES_DIR / "thumbs"
    if thumbs.is_dir():
        for f in thumbs.glob("*.jpg"):
            f.unlink()
    yield


def _add(name: str, *, body: bytes | None = None, workspace: str = "default",
         memo_type: str = "document", thumb: str | None = None,
         on_disk: bool = True) -> str:
    """Register a memo with a real file behind it, in the throwaway FILES_DIR."""
    memo_id = str(uuid.uuid4())
    folder = settings.FILES_DIR / workspace
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{memo_id}{name[name.rfind('.'):]}"
    if on_disk:
        path.write_bytes(body if body is not None else _pdf_bytes())

    async def _insert():
        async with AsyncSessionLocal() as db:
            db.add(Memo(
                id=memo_id, type=memo_type, title=name,
                file_path=str(path), thumbnail_path=thumb,
                workspace_id=workspace,
            ))
            await db.commit()

    asyncio.run(_insert())
    return memo_id


def _thumbnail_of(memo_id: str) -> str | None:
    async def _read():
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            return memo.thumbnail_path if memo else None

    return asyncio.run(_read())


def test_renders_a_cover_and_records_it_on_the_memo(client):
    memo_id = _add("lease.pdf")

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["rendered"] == 1
    assert body["failed"] == 0
    assert _thumbnail_of(memo_id) == f"/api/files/thumb/{memo_id}.jpg"
    cover = settings.FILES_DIR / "thumbs" / f"{memo_id}.jpg"
    assert cover.is_file() and cover.stat().st_size > 0


def test_reaches_pdfs_inside_a_space(client):
    """A Space's cards are just as blank, so the sweep must not stop at the library."""
    in_library = _add("library.pdf")
    in_space = _add("home.pdf", workspace="0e75687c-home")

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["total_pdfs"] == 2
    assert body["rendered"] == 2
    assert _thumbnail_of(in_library) is not None
    assert _thumbnail_of(in_space) is not None


def test_ignores_documents_that_are_not_pdfs(client):
    """.docx and .epub share the "document" type and cannot be rasterized."""
    pdf = _add("real.pdf")
    docx = _add("notes.docx", body=b"PK\x03\x04 not a pdf")
    epub = _add("book.epub", body=b"PK\x03\x04 also not a pdf")

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["total_pdfs"] == 1
    assert body["rendered"] == 1
    assert _thumbnail_of(pdf) is not None
    assert _thumbnail_of(docx) is None
    assert _thumbnail_of(epub) is None


def test_a_dry_run_writes_nothing(client):
    memo_id = _add("preview.pdf")

    body = client.post("/api/maintenance/backfill-pdf-thumbs?dry_run=true").json()

    assert body["dry_run"] is True
    assert body["would_render"] == 1
    assert body["rendered"] == 0
    assert "preview.pdf" in body["titles"]
    assert _thumbnail_of(memo_id) is None
    assert not (settings.FILES_DIR / "thumbs" / f"{memo_id}.jpg").is_file()


def test_a_memo_that_already_has_its_cover_is_skipped(client):
    memo_id = _add("done.pdf")
    first = client.post("/api/maintenance/backfill-pdf-thumbs").json()
    assert first["rendered"] == 1

    second = client.post("/api/maintenance/backfill-pdf-thumbs").json()
    assert second["rendered"] == 0
    assert second["skipped_existing"] == 1


def test_a_stored_path_with_no_file_behind_it_is_re_rendered(client):
    """The broken-cover case: the DB says there is a cover, the disk disagrees."""
    memo_id = _add("stale.pdf", thumb="/api/files/thumb/stale.jpg")

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["rendered"] == 1
    assert body["skipped_existing"] == 0
    assert _thumbnail_of(memo_id) == f"/api/files/thumb/{memo_id}.jpg"


def test_force_re_renders_an_existing_cover(client):
    memo_id = _add("again.pdf")
    client.post("/api/maintenance/backfill-pdf-thumbs")
    cover = settings.FILES_DIR / "thumbs" / f"{memo_id}.jpg"
    cover.write_bytes(b"deliberately corrupted")

    body = client.post("/api/maintenance/backfill-pdf-thumbs?force=true").json()

    assert body["rendered"] == 1
    assert cover.stat().st_size > 100


def test_a_missing_source_file_is_counted_not_crashed(client):
    _add("gone.pdf", on_disk=False)

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["missing_file"] == 1
    assert body["rendered"] == 0
    assert body["failed"] == 0


def test_an_unreadable_pdf_is_counted_as_failed(client):
    _add("broken.pdf", body=b"this is not a pdf at all")

    body = client.post("/api/maintenance/backfill-pdf-thumbs").json()

    assert body["total_pdfs"] == 1
    assert body["failed"] == 1
    assert body["rendered"] == 0
