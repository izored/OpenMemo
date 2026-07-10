"""RAG pipeline - retrieval-augmented generation for AskMemo."""
from typing import AsyncGenerator

from backend.core.embedder import search_similar
from backend.core.ollama_client import ollama_client


SYSTEM_PROMPT = """You are MemoAI, a helpful assistant that answers questions using ONLY the provided context from the user's saved memos (articles, notes, videos, documents, etc.).

Rules:
1. Answer based ONLY on the provided context. Do not use external knowledge.
2. Cite sources using [1], [2], etc. format, corresponding to the provided sources.
3. If the context doesn't contain enough information to answer, say so honestly.
4. Be concise and helpful. Provide structured answers when appropriate.
5. When multiple sources discuss the same topic, synthesize them into a coherent answer.
"""

GENERAL_SYSTEM_PROMPT = """You are MemoAI, a helpful general-purpose assistant. Answer the user's question to the best of your ability."""

# Used when a single-memo chat has only the memo's title + metadata (no
# transcript or extracted text yet) — a freshly-saved song, an un-pulled link.
# Here the model SHOULD lean on general knowledge to interpret what the title
# points at, rather than refusing for lack of a body (OPNMMO-0045).
THIN_MEMO_SYSTEM_PROMPT = """You are MemoAI, answering about one saved memo. The only details available are the memo's title and basic metadata below — there is no transcript or extracted text. Use the title and metadata together with your own general knowledge to give a helpful answer: identify what it likely refers to, give relevant background, and answer the question. Be honest about what is inferred from the title versus known fact, and keep it concise."""

# Streamed verbatim (no LLM call) when retrieval finds nothing above the
# relevance bar. Honest and instant beats a model hallucinating from an empty
# context block.
NO_CONTEXT_MESSAGE = (
    "I couldn't find anything in your memos relevant to that question. "
    "Try rephrasing it, or switch the composer to **Chat** mode to talk to the "
    "model without your memos."
)


def build_context_prompt(sources: list[dict]) -> str:
    """Build context block from retrieved chunks."""
    context_parts = []
    for i, source in enumerate(sources, 1):
        title = source["metadata"].get("title", "Untitled")
        domain = source["metadata"].get("source_domain", "")
        source_info = f"[{i}] {title}"
        if domain:
            source_info += f" ({domain})"
        context_parts.append(f"{source_info}\n{source['document']}\n")

    return "---\nCONTEXT FROM USER'S MEMOS:\n\n" + "\n".join(context_parts) + "\n---"


# Cap for a single-memo chat fed whole (description + transcript/extracted). Big
# enough for a long talk's transcript while staying inside a local model's window.
_MEMO_CONTEXT_CAP = 24000


def build_memo_context(
    description: str | None,
    content_text: str | None,
    content_raw: str | None,
    transcript_done: bool,
) -> str:
    """Whole-memo context for a single-memo "Ask this memo" chat: description +
    transcript/extracted content together (OPNMMO-0042). For media, content_text
    holds the description until a transcript is pulled, then the transcript — so
    dedupe when they're identical. Capped to fit the model's context window."""
    desc = (description or "").strip()
    body = (content_text or content_raw or "").strip()
    parts: list[str] = []
    if desc and desc != body:
        parts.append("DESCRIPTION:\n" + desc)
    if body:
        parts.append((("TRANSCRIPT:\n" if transcript_done else "CONTENT:\n")) + body)
    return "\n\n".join(parts)[:_MEMO_CONTEXT_CAP]


def build_memo_header(
    title: str | None,
    artist: str | None = None,
    album: str | None = None,
    domain: str | None = None,
    mtype: str | None = None,
) -> str:
    """A few lines of memo metadata (title first) used as the minimum context for
    a single-memo chat. When a memo has no transcript/extracted body, this is the
    whole context so Ask can still reason from the title (OPNMMO-0045)."""
    lines = [f"Title: {(title or 'Untitled').strip()}"]
    if artist:
        lines.append(f"Artist: {artist.strip()}")
    if album:
        lines.append(f"Album: {album.strip()}")
    if domain:
        lines.append(f"Source: {domain.strip()}")
    if mtype:
        lines.append(f"Type: {mtype.strip()}")
    return "\n".join(lines)


async def rag_chat(
    query: str,
    workspace_id: str | None = None,
    collection_id: str | None = None,
    memo_id: str | None = None,
    model: str | None = None,
    history: list[dict] | None = None,
    use_rag: bool = True,
    memo_context: str | None = None,
    memo_source: dict | None = None,
    memo_thin: bool = False,
) -> AsyncGenerator[dict, None]:
    """RAG chat pipeline with streaming response.

    Yields dicts: {"type": "sources", "data": [...]} then {"type": "token", "data": "..."}
    """
    sources = []

    # Single-memo chat (OPNMMO-0042): feed the WHOLE memo — description plus
    # transcript/extracted content — instead of a few retrieved chunks, so the
    # answer sees everything the page shows (not just whatever was last embedded).
    if use_rag and memo_context:
        yield {"type": "sources", "data": [memo_source] if memo_source else []}
        context = "---\nCONTEXT FROM THIS MEMO:\n\n" + memo_context + "\n---"
        # Title/metadata-only context gets the softer prompt that lets the model
        # interpret the memo from its title; a full body keeps the strict
        # answer-only-from-context prompt (OPNMMO-0045).
        system = THIN_MEMO_SYSTEM_PROMPT if memo_thin else SYSTEM_PROMPT
        messages = [{"role": "system", "content": system}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": f"{context}\n\nQuestion: {query}"})
        async for token in ollama_client.chat(messages=messages, model=model, stream=True):
            yield {"type": "token", "data": token}
        return

    if use_rag:
        # Retrieve relevant chunks
        sources = await search_similar(
            query=query,
            workspace_id=workspace_id,
            collection_id=collection_id,
            memo_id=memo_id,
        )
        
        # Yield sources first so frontend can display them
        yield {
            "type": "sources",
            "data": [
                {
                    "memo_id": s["metadata"].get("memo_id"),
                    "title": s["metadata"].get("title", "Untitled"),
                    "domain": s["metadata"].get("source_domain", ""),
                    "snippet": s["document"][:200],
                    "distance": s["distance"],
                }
                for s in sources
            ],
        }
        
        # Nothing relevant retrieved — answer honestly without burning an LLM
        # call on an empty context (the model would either hallucinate or
        # produce a slower version of this exact message).
        if not sources:
            yield {"type": "token", "data": NO_CONTEXT_MESSAGE}
            return

        # Build messages. History goes BEFORE the context+question turn so
        # follow-ups ("and what about X?") keep working in RAG mode too.
        context = build_context_prompt(sources)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if history:
            messages.extend(history[-6:])  # Last 3 exchanges
        messages.append({"role": "user", "content": f"{context}\n\nQuestion: {query}"})
    else:
        # Direct LLM query (no RAG)
        messages = [
            {"role": "system", "content": GENERAL_SYSTEM_PROMPT},
        ]
        # Add history if available
        if history:
            messages.extend(history[-6:])  # Last 3 exchanges
        messages.append({"role": "user", "content": query})
    
    # Stream response
    async for token in ollama_client.chat(messages=messages, model=model, stream=True):
        yield {"type": "token", "data": token}


# On-demand summary modes. Each is fed the FULL transcript/content (timestamp
# mode relies on the inline [mm:ss] markers the transcript carries). The user
# picks a mode in the UI; the result is cached per-mode on the memo.
SUMMARY_MODES = {
    "insights": {
        "system": "You are a concise summarizer. Extract the key points only.",
        "user": (
            "Extract the key insights and takeaways from the content below. "
            "Return 4-8 tight bullet points, most important first. No preamble.\n\n{text}"
        ),
    },
    "timestamp": {
        "system": (
            "You summarize talks and videos into a chronological, timestamped outline. "
            "Only use timestamps that appear in the transcript — never invent them."
        ),
        "user": (
            "The transcript below has inline [mm:ss] (or [h:mm:ss]) timestamps. Produce a "
            "chronological bullet outline of the key moments across the WHOLE talk. Start each "
            "bullet with the nearest real timestamp copied verbatim from the transcript, then a "
            "short description of what is covered. Aim for 8-15 evenly spaced bullets.\n\n{text}"
        ),
    },
    "essay": {
        "system": "You are a thoughtful writer who distills long content into clear prose.",
        "user": (
            "Write a flowing prose summary (2-4 short paragraphs) of the content below. Capture "
            "the main argument and the key supporting points. No bullet lists, no timestamps.\n\n{text}"
        ),
    },
}

# Cap fed to the model. Generous enough for a long talk's transcript while
# staying within a typical local model's context window.
_SUMMARY_INPUT_CAP = 16000


async def generate_summary(text: str, mode: str = "insights", model: str | None = None) -> str:
    """Generate an AI summary in one of SUMMARY_MODES. Unknown modes fall back
    to 'insights' so callers never crash on a bad mode."""
    spec = SUMMARY_MODES.get(mode, SUMMARY_MODES["insights"])
    messages = [
        {"role": "system", "content": spec["system"]},
        {"role": "user", "content": spec["user"].format(text=text[:_SUMMARY_INPUT_CAP])},
    ]
    return await ollama_client.chat_sync(messages=messages, model=model)
