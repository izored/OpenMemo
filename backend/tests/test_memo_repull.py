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
