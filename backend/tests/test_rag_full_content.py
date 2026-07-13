"""Ask Memo full-content retrieval (OPNMMO-0058).

A retrieved video memo must reach the model with its description / summary, not
just the chunks that matched — the fix for Ask calling video memos "just links".
Covers both the write path (what gets embedded) and the read path (what frames
the chunks fed to the model).
"""
import uuid
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.core.embedder import build_embed_text
from backend.core.rag import build_context_prompt, memo_framing_text
from backend.db.database import AsyncSessionLocal
from backend.db.models import Memo


@pytest.fixture
def client():
    from backend.main import app

    with TestClient(app) as c:
        yield c


# --- write path: build_embed_text ---

def test_embed_text_includes_video_description_without_transcript():
    """A video with only a platform description (no transcript) must still
    produce embeddable text — the bug was it embedded nothing."""
    memo = SimpleNamespace(
        title="1972 Toyota Corolla: Full Build",
        video_description="A 3-year restoration covering the exhaust system and rebuild.",
        description=None, content_text=None, content_raw=None,
        ai_summary=None, notes=None,
    )
    text = build_embed_text(memo)
    assert "Toyota Corolla" in text
    assert "exhaust system" in text


def test_embed_text_combines_description_and_transcript():
    """Once transcribed, both the blurb and the spoken words are embedded."""
    memo = SimpleNamespace(
        title="Talk", video_description="Author's framing blurb.",
        description=None, content_text="the actual spoken transcript here",
        content_raw=None, ai_summary=None, notes=None,
    )
    text = build_embed_text(memo)
    assert "Author's framing blurb." in text
    assert "spoken transcript" in text


def test_embed_text_empty_for_title_only_memo():
    """A memo with only a title (fresh song, un-pulled link) embeds nothing."""
    memo = SimpleNamespace(
        title="Some Song", video_description=None, description=None,
        content_text=None, content_raw=None, ai_summary=None, notes=None,
    )
    assert build_embed_text(memo) == ""


def test_embed_text_dedupes_seeded_description():
    """Before transcription content_text == video_description; don't embed twice."""
    blurb = "identical seeded blurb"
    memo = SimpleNamespace(
        title="V", video_description=blurb, description=None,
        content_text=blurb, content_raw=None, ai_summary=None, notes=None,
    )
    assert build_embed_text(memo).count(blurb) == 1


# --- read path: framing ---

def test_framing_prefers_summary_over_description():
    assert memo_framing_text("desc", "vid desc", "AI summary") == "AI summary"


def test_framing_falls_back_to_video_description():
    assert memo_framing_text(None, "video blurb", None) == "video blurb"


def test_context_prompt_includes_framing_and_skips_duplicate_chunk():
    groups = [{
        "title": "Toyota Corolla Build", "domain": "youtube.com",
        "framing": "A 3-year restoration build log.",
        "documents": ["A 3-year restoration build log.", "welding the floor pans"],
    }]
    ctx = build_context_prompt(groups)
    assert "A 3-year restoration build log." in ctx
    assert "welding the floor pans" in ctx
    # framing text isn't duplicated when a chunk equals it
    assert ctx.count("A 3-year restoration build log.") == 1


# --- integration: framing reaches the model ---

async def _make_video(memo_id: str, desc: str) -> None:
    async with AsyncSessionLocal() as db:
        db.add(Memo(
            id=memo_id, workspace_id="default", type="video",
            title="Toyota Corolla Full Build", video_description=desc,
            content_text="body", is_deleted=False,
            created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
        ))
        await db.commit()


async def test_video_description_reaches_the_model(client, monkeypatch):
    """End to end: a retrieved video memo's description lands in the prompt."""
    import backend.core.rag as rag
    import backend.db.fts5 as fts5

    mid = str(uuid.uuid4())
    desc = "A three year full restoration, no prior experience."
    await _make_video(mid, desc)

    async def fake_search_similar(**kwargs):
        return [{
            "id": f"memo_{mid}_chunk_0", "document": "welding floor pans",
            "metadata": {"memo_id": mid, "title": "Toyota Corolla Full Build", "source_domain": "youtube.com"},
            "distance": 0.2,
        }]

    async def fake_fts(query, workspace_id, limit=20):
        return []

    captured = {}

    async def fake_chat(messages, model=None, stream=True):
        captured["messages"] = messages
        yield "answer"

    monkeypatch.setattr(rag, "search_similar", fake_search_similar)
    monkeypatch.setattr(fts5, "search_fts5", fake_fts)
    monkeypatch.setattr(rag.ollama_client, "chat", fake_chat)

    async for _ in rag.rag_chat(query="summarize", workspace_id="default"):
        pass

    prompt = captured["messages"][-1]["content"]
    assert desc in prompt          # the description framed the memo
    assert "welding floor pans" in prompt  # the matched chunk is still there


# --- smart thread titles ---

async def test_generate_title_returns_clean_title(monkeypatch):
    import backend.core.rag as rag

    async def fake(messages, model=None):
        return '"Toyota Corolla restoration."'  # quotes + trailing dot to strip

    monkeypatch.setattr(rag.ollama_client, "chat_sync", fake)
    out = await rag.generate_title("how do I rebuild it", "long answer", None)
    assert out == "Toyota Corolla restoration"


async def test_generate_title_strips_think_and_falls_back(monkeypatch):
    import backend.core.rag as rag

    async def thinky(messages, model=None):
        return "<think>hmm</think>\nSaved video recap"

    monkeypatch.setattr(rag.ollama_client, "chat_sync", thinky)
    assert await rag.generate_title("q", "a", None) == "Saved video recap"

    async def boom(messages, model=None):
        raise RuntimeError("ollama down")

    monkeypatch.setattr(rag.ollama_client, "chat_sync", boom)
    assert await rag.generate_title("q", "a", None) is None  # caller keeps fallback
