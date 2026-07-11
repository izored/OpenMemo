"""Embed failure surfacing + retry (plans/007).

process_memo used to swallow embed failures with a log line — the memo
silently never entered RAG/search and nothing could find it to retry.
"""
import asyncio
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


async def _make_memo(content: str = "hello embedding world") -> str:
    memo_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            workspace_id="default",
            type="note",
            title="embed test",
            content_text=content,
            content_raw=content,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ))
        await db.commit()
    return memo_id


async def _get_memo(memo_id: str) -> Memo:
    async with AsyncSessionLocal() as db:
        return await db.get(Memo, memo_id)


async def test_failure_persists_error_status(client, monkeypatch):
    import backend.core.embedder as embedder

    async def boom(**kwargs):
        raise RuntimeError("ollama is down")

    monkeypatch.setattr(embedder, "embed_memo", boom)

    from backend.api.ingest import process_memo

    memo_id = await _make_memo()
    await process_memo(memo_id)

    memo = await _get_memo(memo_id)
    assert memo.embed_status == "error"
    assert not memo.is_processed


async def test_success_persists_ok_status(client, monkeypatch):
    import backend.core.embedder as embedder

    async def fake_embed(**kwargs):
        return ["c1", "c2"]

    monkeypatch.setattr(embedder, "embed_memo", fake_embed)

    from backend.api.ingest import process_memo

    memo_id = await _make_memo()
    await process_memo(memo_id)

    memo = await _get_memo(memo_id)
    assert memo.embed_status == "ok"
    assert memo.is_processed
    assert memo.embedding_ids == ["c1", "c2"]


def test_reembed_endpoint_schedules_and_404s(client, monkeypatch):
    import backend.core.embedder as embedder

    async def fake_embed(**kwargs):
        return ["c1"]

    monkeypatch.setattr(embedder, "embed_memo", fake_embed)

    loop = asyncio.new_event_loop()
    try:
        memo_id = loop.run_until_complete(_make_memo())
    finally:
        loop.close()

    resp = client.post(f"/api/memos/{memo_id}/reembed")
    assert resp.status_code == 200
    assert resp.json()["status"] == "scheduled"

    resp = client.post("/api/memos/does-not-exist/reembed")
    assert resp.status_code == 404
