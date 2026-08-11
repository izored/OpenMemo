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
