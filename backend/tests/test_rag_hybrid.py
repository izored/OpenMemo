"""Hybrid retrieval + follow-up condensation (ADR-022).

The keyword leg must surface exact-name memos the vector pool missed, and
follow-ups must be condensed into standalone queries for retrieval only.
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


async def _make_memo(memo_id: str, title: str = "memo") -> None:
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id,
            workspace_id="default",
            type="note",
            title=title,
            content_text="body",
            is_deleted=False,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ))
        await db.commit()


def _chunk(memo_id: str, title: str, doc: str, distance: float) -> dict:
    return {
        "id": f"memo_{memo_id}_chunk_0",
        "document": doc,
        "metadata": {"memo_id": memo_id, "title": title, "source_domain": ""},
        "distance": distance,
    }


async def test_keyword_memo_joins_sources(client, monkeypatch):
    """A memo found only by FTS keyword match must still be cited."""
    import backend.core.rag as rag
    import backend.db.fts5 as fts5

    vec_id = str(uuid.uuid4())
    kw_id = str(uuid.uuid4())
    await _make_memo(vec_id, "vector hit")
    await _make_memo(kw_id, "Toyota Hilux build log")

    async def fake_search_similar(**kwargs):
        if kwargs.get("memo_ids"):
            # keyword leg: chunks for the FTS-matched memo, cutoff disabled
            assert kwargs["memo_ids"] == [kw_id]
            assert kwargs["max_distance"] == 2.0
            return [_chunk(kw_id, "Toyota Hilux build log", "hilux doc", 1.1)]
        return [_chunk(vec_id, "vector hit", "vec doc", 0.2)]

    async def fake_fts(query, workspace_id, limit=20):
        return [{"memo_id": kw_id, "rank": -1.0}, {"memo_id": vec_id, "rank": -0.5}]

    async def fake_chat(messages, model=None, stream=True):
        yield "answer"

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)
    monkeypatch.setattr(fts5, "search_fts5", fake_fts)
    monkeypatch.setattr(rag.ollama_client, "chat", fake_chat)

    events = []
    async for ev in rag.rag_chat(query="toyota hilux", workspace_id="default"):
        events.append(ev)

    sources = next(e for e in events if e["type"] == "sources")["data"]
    ids = [s["memo_id"] for s in sources]
    assert vec_id in ids
    assert kw_id in ids
    # vector hits come first — keyword leg is supplementary
    assert ids.index(vec_id) < ids.index(kw_id)


async def test_keyword_leg_skipped_for_scoped_asks(client, monkeypatch):
    """Single-memo / collection scoping must not run the FTS leg."""
    import backend.core.rag as rag
    import backend.db.fts5 as fts5

    memo = str(uuid.uuid4())
    await _make_memo(memo, "scoped")

    async def fake_search_similar(**kwargs):
        return [_chunk(memo, "scoped", "doc", 0.2)]

    async def fts_must_not_run(*a, **k):
        raise AssertionError("FTS leg ran for a scoped ask")

    async def fake_chat(messages, model=None, stream=True):
        yield "answer"

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)
    monkeypatch.setattr(fts5, "search_fts5", fts_must_not_run)
    monkeypatch.setattr(rag.ollama_client, "chat", fake_chat)

    events = []
    async for ev in rag.rag_chat(query="q", workspace_id="default", collection_id="c1"):
        events.append(ev)
    assert any(e["type"] == "token" for e in events)


async def test_followup_condensed_for_retrieval_only(client, monkeypatch):
    """With history, retrieval uses the condensed query; the answering prompt
    keeps the user's original words."""
    import backend.core.rag as rag
    import backend.db.fts5 as fts5

    memo = str(uuid.uuid4())
    await _make_memo(memo, "hit")

    seen_queries = []

    async def fake_search_similar(**kwargs):
        seen_queries.append(kwargs["query"])
        return [_chunk(memo, "hit", "doc", 0.2)]

    async def fake_fts(query, workspace_id, limit=20):
        return []

    async def fake_chat_sync(messages, model=None):
        return "toyota hilux price"

    captured_messages = {}

    async def fake_chat(messages, model=None, stream=True):
        captured_messages["messages"] = messages
        yield "answer"

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)
    monkeypatch.setattr(fts5, "search_fts5", fake_fts)
    monkeypatch.setattr(rag.ollama_client, "chat_sync", fake_chat_sync)
    monkeypatch.setattr(rag.ollama_client, "chat", fake_chat)

    history = [
        {"role": "user", "content": "what do my memos say about the toyota hilux?"},
        {"role": "assistant", "content": "It is reliable [1]."},
    ]
    events = []
    async for ev in rag.rag_chat(query="and the price?", workspace_id="default", history=history):
        events.append(ev)

    assert seen_queries == ["toyota hilux price"]
    # original question reaches the model, not the condensed one
    assert "and the price?" in captured_messages["messages"][-1]["content"]


async def test_condense_falls_back_on_failure(client, monkeypatch):
    import backend.core.rag as rag

    async def broken_chat_sync(messages, model=None):
        raise RuntimeError("ollama down")

    monkeypatch.setattr(rag.ollama_client, "chat_sync", broken_chat_sync)
    out = await rag.condense_query("and the price?", [{"role": "user", "content": "hi"}], None)
    assert out == "and the price?"


async def test_condense_strips_think_blocks(client, monkeypatch):
    import backend.core.rag as rag

    async def thinky_chat_sync(messages, model=None):
        return "<think>the user means the hilux</think>\ntoyota hilux price"

    monkeypatch.setattr(rag.ollama_client, "chat_sync", thinky_chat_sync)
    out = await rag.condense_query("and the price?", [{"role": "user", "content": "hilux?"}], None)
    assert out == "toyota hilux price"
