"""RAG must not cite deleted memos (plans/009).

A failed Chroma purge leaves ghost vectors; rag_chat used to hydrate sources
straight from Chroma metadata, so Ask Memo cited memos whose links 404.
"""
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


async def _make_memo(memo_id: str, deleted: bool) -> None:
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            workspace_id="default",
            type="note",
            title=f"memo {memo_id[:8]}",
            content_text="body",
            is_deleted=deleted,
            deleted_at=datetime.utcnow() if deleted else None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ))
        await db.commit()


async def test_rag_sources_exclude_deleted_memos(client, monkeypatch):
    import backend.core.rag as rag

    live_id = str(uuid.uuid4())
    gone_id = str(uuid.uuid4())
    await _make_memo(live_id, deleted=False)
    await _make_memo(gone_id, deleted=True)

    async def fake_search_similar(**kwargs):
        return [
            {"metadata": {"memo_id": live_id, "title": "live"}, "document": "live doc", "distance": 0.1},
            {"metadata": {"memo_id": gone_id, "title": "gone"}, "document": "ghost doc", "distance": 0.2},
        ]

    async def fake_chat(messages, model=None, stream=True):
        yield "answer"

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)
    monkeypatch.setattr(rag.ollama_client, "chat", fake_chat)

    events = []
    async for ev in rag.rag_chat(query="q", workspace_id="default"):
        events.append(ev)

    sources_ev = next(e for e in events if e["type"] == "sources")
    ids = [s["memo_id"] for s in sources_ev["data"]]
    assert live_id in ids
    assert gone_id not in ids


async def test_rag_all_ghosts_yields_no_context(client, monkeypatch):
    import backend.core.rag as rag

    gone_id = str(uuid.uuid4())
    await _make_memo(gone_id, deleted=True)

    async def fake_search_similar(**kwargs):
        return [{"metadata": {"memo_id": gone_id, "title": "gone"}, "document": "ghost", "distance": 0.2}]

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)

    events = []
    async for ev in rag.rag_chat(query="q", workspace_id="default"):
        events.append(ev)

    sources_ev = next(e for e in events if e["type"] == "sources")
    assert sources_ev["data"] == []
    token_ev = next(e for e in events if e["type"] == "token")
    assert token_ev["data"] == rag.NO_CONTEXT_MESSAGE
