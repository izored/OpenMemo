"""Re-pull: fetch a memo's source again and apply what comes back.

"Make it local" downloads and nothing else, which is right for a memo that is
merely remote and wrong for one that is broken — a video that will not play, a
caption still reading "Instagram post", a cover pointing at a file that is gone.
"""
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


async def _never(*a, **kw):
    """A stand-in for the media downloader that fails the test if it is called."""
    raise AssertionError("this memo has no media stream and must never reach yt-dlp")


def _memo(client, **fields) -> str:
    body = {"type": "video", "title": f"repull {uuid.uuid4().hex[:6]}", **fields}
    resp = client.post("/api/memos", json=body)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def test_an_upload_has_nothing_to_pull_from(client):
    """The button is hidden for these, but the endpoint must not depend on the
    UI being right — it answers with the reason, not a 500."""
    memo_id = _memo(client)
    resp = client.post(f"/api/memos/{memo_id}/repull")
    assert resp.status_code == 400
    assert "uploaded" in resp.json()["detail"].lower()


def test_a_missing_memo_is_a_404(client):
    assert client.post(f"/api/memos/{uuid.uuid4()}/repull").status_code == 404


def test_it_queues_and_marks_the_memo_pending(client):
    """Pending is what the detail page polls on, and what disables the button,
    so it has to be set before the response comes back rather than whenever the
    background task gets around to it."""
    memo_id = _memo(client, source_url="https://example.com/watch?v=abc")
    body = client.post(f"/api/memos/{memo_id}/repull").json()

    assert body["status"] == "pending"
    assert body["mode"] == "video"
    assert client.get(f"/api/memos/{memo_id}").json()["localize_status"] == "pending"


def test_an_audio_memo_asks_for_audio(client):
    """That is what the original save produced; asking for video would hand back
    something the memo cannot play."""
    memo_id = _memo(client, type="audio", source_url="https://example.com/track")
    assert client.post(f"/api/memos/{memo_id}/repull").json()["mode"] == "audio"


def test_a_previous_failure_is_cleared_before_retrying(client):
    """A stale error next to a fresh attempt reads as if the attempt failed."""
    from datetime import datetime

    memo_id = _memo(client, source_url="https://example.com/x")
    client.post(f"/api/memos/{memo_id}/repull")

    import sqlite3
    from pathlib import Path

    from backend.config import settings

    con = sqlite3.connect(str(Path(settings.DATA_DIR) / "openmemo.db"))
    with con:
        con.execute(
            "update memos set localize_status='error', localize_error='old failure', updated_at=? where id=?",
            (datetime.utcnow().isoformat(), memo_id),
        )
    con.close()

    client.post(f"/api/memos/{memo_id}/repull")
    fresh = client.get(f"/api/memos/{memo_id}").json()
    assert fresh["localize_status"] == "pending"
    assert not fresh.get("localize_error")


class TestAPictureMemoIsNotHandedToTheVideoDownloader:
    """Repairing the six rotted carousels marked all six as failed.

    A photo post has no media stream. Running yt-dlp against it buys one
    guaranteed "No video formats found", which lands on the memo as
    `localize_error` and shows a red chip on a card whose pictures are fine.
    The pictures ARE the content, and the re-resolve step already fetched them.
    """

    async def test_an_image_memo_skips_the_download_and_clears_the_error(self, monkeypatch):
        import uuid

        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(
                id=memo_id,
                type="image",
                title="carousel",
                source_url="https://example.com/photos/1",
                thumbnail_path="/api/files/thumb/x.jpg",
                localize_status="error",
                localize_error="yt-dlp failed: No video formats found!",
            ))
            await db.commit()

        async def boom(*a, **kw):
            raise AssertionError("a picture memo must never reach the media downloader")

        monkeypatch.setattr(ingest, "localize_memo_task", boom)

        await ingest.repull_memo_task(memo_id, "video")

        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            assert memo.localize_status is None
            assert memo.localize_error is None

    async def test_a_video_memo_still_downloads(self, monkeypatch):
        import uuid

        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="video", title="clip",
                        source_url="https://example.com/watch/1"))
            await db.commit()

        called = []

        async def fake(mid, mode, *a, **kw):
            called.append((mid, mode))

        monkeypatch.setattr(ingest, "localize_memo_task", fake)

        await ingest.repull_memo_task(memo_id, "video")

        assert called == [(memo_id, "video")]


class TestReResolveRunsForEveryHost:
    """Re-pull used to re-resolve only instagram.com.

    Every other host skipped straight to yt-dlp, which quietly redefined
    "re-pull this memo" as "re-download the file" for the whole rest of the
    web. A Temu link whose card was blank got a red error chip and never got
    the second look that would have filled it in. ADR-001: one rule, no
    per-host branches.
    """

    async def test_a_non_instagram_link_is_re_resolved(self, client, monkeypatch):
        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="link", title="Temu",
                        source_url="https://www.temu.com/be/a-lamp-g-1.html"))
            await db.commit()

        seen = []

        async def fake_extract(url, *a, **kw):
            seen.append(url)
            return {"title": "A very nice lamp - Temu",
                    "description": "warm white",
                    "thumbnail_path": "https://img.kwcdn.com/product/open/x-goods.jpeg"}

        monkeypatch.setattr("backend.core.extractor.extract_url", fake_extract)
        monkeypatch.setattr(ingest, "localize_memo_task", _never)

        await ingest.repull_memo_task(memo_id, "video")

        assert seen == ["https://www.temu.com/be/a-lamp-g-1.html"]
        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            assert memo.title == "A very nice lamp - Temu"
            assert memo.thumbnail_path == "https://img.kwcdn.com/product/open/x-goods.jpeg"

    async def test_a_plain_link_never_reaches_yt_dlp(self, client, monkeypatch):
        """The skip used to be spelled `type == "image"`, so an article or a
        shopping link still walked into "No video formats found"."""
        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="link", title="Temu",
                        source_url="https://www.temu.com/be/a-lamp-g-1.html",
                        localize_status="error",
                        localize_error="yt-dlp failed: No video formats found!"))
            await db.commit()

        async def nothing(url, *a, **kw):
            return {}

        monkeypatch.setattr("backend.core.extractor.extract_url", nothing)
        monkeypatch.setattr(ingest, "localize_memo_task", _never)

        await ingest.repull_memo_task(memo_id, "video")

        async with AsyncSessionLocal() as db:
            memo = await db.get(Memo, memo_id)
            # The stale error from the old behaviour is cleared, not reapplied.
            assert memo.localize_status is None
            assert memo.localize_error is None

    async def test_a_title_the_user_wrote_is_never_overwritten(self, client, monkeypatch):
        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="link", title="Lamp for the hallway",
                        source_url="https://www.temu.com/be/a-lamp-g-1.html"))
            await db.commit()

        async def fake_extract(url, *a, **kw):
            return {"title": "A very nice lamp - Temu", "thumbnail_path": ""}

        monkeypatch.setattr("backend.core.extractor.extract_url", fake_extract)
        monkeypatch.setattr(ingest, "localize_memo_task", _never)

        await ingest.repull_memo_task(memo_id, "video")

        async with AsyncSessionLocal() as db:
            assert (await db.get(Memo, memo_id)).title == "Lamp for the hallway"

    async def test_an_existing_cover_is_left_alone(self, client, monkeypatch):
        """Step 1 fills a GAP and never replaces a cover that is already there.

        The cover here is a remote URL, deliberately: a LOCAL path with no file
        behind it is a BROKEN cover, and clearing that is step 3's documented
        job, which would mask what this test is actually about."""
        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="link", title="Temu",
                        source_url="https://www.temu.com/be/a-lamp-g-1.html",
                        thumbnail_path="https://cdn/already-mine.jpg"))
            await db.commit()

        async def fake_extract(url, *a, **kw):
            return {"title": "", "thumbnail_path": "https://cdn/other.jpg"}

        monkeypatch.setattr("backend.core.extractor.extract_url", fake_extract)
        monkeypatch.setattr(ingest, "localize_memo_task", _never)

        await ingest.repull_memo_task(memo_id, "video")

        async with AsyncSessionLocal() as db:
            assert (await db.get(Memo, memo_id)).thumbnail_path == "https://cdn/already-mine.jpg"

    async def test_a_resolver_failure_is_survivable(self, client, monkeypatch):
        """A dead source must leave the memo as it was, not half-written."""
        from backend.api import ingest
        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        memo_id = str(uuid.uuid4())
        async with AsyncSessionLocal() as db:
            db.add(Memo(id=memo_id, type="link", title="Temu",
                        source_url="https://www.temu.com/be/a-lamp-g-1.html"))
            await db.commit()

        async def boom(url, *a, **kw):
            raise RuntimeError("network is gone")

        monkeypatch.setattr("backend.core.extractor.extract_url", boom)
        monkeypatch.setattr(ingest, "localize_memo_task", _never)

        await ingest.repull_memo_task(memo_id, "video")

        async with AsyncSessionLocal() as db:
            assert (await db.get(Memo, memo_id)).title == "Temu"


class TestPlaceholderTitle:
    """One rule for "did a human choose this title", asked of any host."""

    def test_the_two_legacy_instagram_cases_still_read_as_placeholders(self):
        from backend.api.ingest import _is_placeholder_title

        assert _is_placeholder_title("Instagram post", "u", "instagram.com")
        assert _is_placeholder_title("Instagram", "u", "instagram.com")

    def test_it_generalises_to_hosts_nobody_hardcoded(self):
        from backend.api.ingest import _is_placeholder_title

        assert _is_placeholder_title("Temu", "u", "temu.com")
        assert _is_placeholder_title("temu.com", "u", "temu.com")
        assert _is_placeholder_title("Reddit thread", "u", "reddit.com")

    def test_empty_and_the_bare_url_are_placeholders(self):
        from backend.api.ingest import _is_placeholder_title

        assert _is_placeholder_title("", "https://x/y", "x.com")
        assert _is_placeholder_title("https://x/y", "https://x/y", "x.com")

    def test_a_real_title_is_not_a_placeholder(self):
        from backend.api.ingest import _is_placeholder_title

        assert not _is_placeholder_title("premium slow rebound - Temu Belgium", "u", "temu.com")
        assert not _is_placeholder_title("Lamp for the hallway", "u", "temu.com")
