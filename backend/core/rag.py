"""RAG pipeline - retrieval-augmented generation for AskMemo."""
import re
from typing import AsyncGenerator

from backend.config import settings
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

# Follow-up condensation (ADR-022): a follow-up like "and what about the
# price?" embeds terribly on its own — retrieval needs the standalone form.
# One cheap LLM call rewrites it before embedding; the ORIGINAL question still
# goes to the answering model.
CONDENSE_SYSTEM_PROMPT = (
    "You rewrite a follow-up question as one standalone search query. Use the "
    "conversation to resolve pronouns and references. Return ONLY the rewritten "
    "query, nothing else — no quotes, no explanation. If the question is "
    "already standalone, return it unchanged."
)

# Reasoning models wrap their monologue in <think> tags — strip before use.
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


async def condense_query(query: str, history: list[dict], model: str | None) -> str:
    """Rewrite a follow-up into a standalone retrieval query using the recent
    conversation. Falls back to the raw query on any failure or a suspicious
    rewrite (empty, or so long the model started chatting)."""
    convo = "\n".join(
        f"{m['role']}: {m['content'][:300]}" for m in history[-4:] if m.get("content")
    )
    messages = [
        {"role": "system", "content": CONDENSE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Conversation:\n{convo}\n\nFollow-up question: {query}\n\nStandalone search query:",
        },
    ]
    try:
        out = await ollama_client.chat_sync(messages=messages, model=model)
        out = _THINK_RE.sub("", out or "").strip().strip('"').strip()
        out = out.splitlines()[0].strip() if out else ""
        if 0 < len(out) <= 300:
            return out
    except Exception:
        pass
    return query


TITLE_SYSTEM_PROMPT = (
    "You write a very short title (3 to 6 words) for a chat, from the user's "
    "first question and the assistant's answer. Return ONLY the title — no "
    "quotes, no trailing punctuation, no preamble. Sentence case."
)


async def generate_title(question: str, answer: str, model: str | None) -> str | None:
    """One cheap LLM call to name a chat thread from its first exchange. Returns
    a short title, or None on any failure or suspicious output so the caller
    keeps its fallback (the truncated question)."""
    messages = [
        {"role": "system", "content": TITLE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Question: {question[:500]}\n\nAnswer: {answer[:800]}\n\nTitle:",
        },
    ]
    try:
        out = await ollama_client.chat_sync(messages=messages, model=model)
        out = _THINK_RE.sub("", out or "").strip().strip('"').strip()
        out = (out.splitlines()[0] if out else "").strip().rstrip(".").strip()
        if 0 < len(out) <= 80:
            return out
    except Exception:
        pass
    return None


async def keyword_memo_chunks(
    retrieval_query: str,
    exclude_memo_ids: set[str],
    workspace_id: str | None,
) -> list[dict]:
    """Keyword leg of hybrid retrieval (ADR-022): FTS5 over titles + content
    finds memos by EXACT words — the proper nouns and brand names pure vector
    search misses. For keyword-matched memos the vector pool didn't already
    surface, pull their best chunks from Chroma WITHOUT the distance cutoff (an
    exact name match earns its seat even when its embedding sits far away).
    Memos with no chunks at all (embed failed/pending) fall back to a
    title+preview pseudo-chunk so a keyword hit is never silently dropped."""
    from backend.db.fts5 import search_fts5

    try:
        hits = await search_fts5(
            retrieval_query, workspace_id or "default", limit=settings.RAG_MAX_SOURCES
        )
    except Exception:
        return []
    kw_ids = [h["memo_id"] for h in hits if h["memo_id"] not in exclude_memo_ids]
    if not kw_ids:
        return []

    # Best chunks for the keyword memos, ranked by the same query embedding so
    # ordering stays comparable. max_distance=2.0 disables the cosine cutoff.
    chunks = await search_similar(
        query=retrieval_query,
        memo_ids=kw_ids,
        n_results=len(kw_ids) * settings.RAG_CHUNKS_PER_MEMO,
        max_distance=2.0,
    )

    # Title+preview fallback for keyword memos with no vectors.
    chunked_ids = {c["metadata"].get("memo_id") for c in chunks}
    missing = [m for m in kw_ids if m not in chunked_ids]
    if missing:
        from sqlalchemy import select

        from backend.db.database import AsyncSessionLocal
        from backend.db.models import Memo

        async with AsyncSessionLocal() as db:
            rows = await db.execute(select(Memo).where(Memo.id.in_(missing)))
            for memo in rows.scalars():
                # video_description before description: a YouTube memo's blurb
                # lives there, not in `description` (OPNMMO-0058).
                doc = (memo.content_text or memo.video_description or memo.description or "")[:600]
                chunks.append({
                    "id": f"memo_{memo.id}_kw",
                    "document": f"{memo.title or 'Untitled'}\n{doc}".strip(),
                    "metadata": {
                        "memo_id": memo.id,
                        "title": memo.title or "Untitled",
                        "source_domain": memo.source_domain or "",
                    },
                    "distance": 2.0,
                })
    return chunks


def group_by_memo(
    chunks: list[dict],
    max_memos: int,
    max_chunks_per_memo: int,
) -> list[dict]:
    """Collapse retrieved chunks (nearest-first) into distinct memos.

    A single memo can own several of the top chunks; showing one citation card
    per chunk makes Ask look like it pulled "8 Toyota memos" when it really
    found two (OPNMMO-0053). Group by memo_id preserving relevance order (the
    first chunk seen for a memo is its nearest), keep up to `max_chunks_per_memo`
    chunks per memo for the model, and cap the whole list to `max_memos` memos.

    Returns a list of {memo_id, title, domain, distance, documents[]} — one per
    memo, ordered by best distance.
    """
    groups: dict[str, dict] = {}
    for ch in chunks:
        meta = ch.get("metadata", {})
        mid = meta.get("memo_id")
        if not mid:
            continue
        g = groups.get(mid)
        if g is None:
            if len(groups) >= max_memos:
                continue  # memo budget spent — skip further new memos
            groups[mid] = {
                "memo_id": mid,
                "title": meta.get("title", "Untitled"),
                "domain": meta.get("source_domain", ""),
                "distance": ch.get("distance", 0),
                "documents": [ch.get("document", "")],
            }
        elif len(g["documents"]) < max_chunks_per_memo:
            g["documents"].append(ch.get("document", ""))
    return list(groups.values())


# Per-memo cap for the framing text (AI summary / description) prepended to a
# cited memo's chunks in library RAG. Small on purpose: the retrieved chunks are
# the semantic match; this adds the author's blurb / AI summary so a video memo
# isn't reduced to "a link" when the transcript wasn't the strongest hit.
_MEMO_FRAMING_CAP = 1500


def memo_framing_text(
    description: str | None,
    video_description: str | None,
    ai_summary: str | None,
) -> str:
    """Short framing text for a retrieved memo: its AI summary if one exists,
    else its description (platform blurb for videos, extracted lede otherwise).
    Prepended to the memo's matched chunks so the model sees what the memo IS —
    a cooking video, a build log — not only the slices that happened to match
    (OPNMMO-0058). Capped to keep the multi-memo context inside the window."""
    summary = (ai_summary or "").strip()
    if summary:
        return summary[:_MEMO_FRAMING_CAP]
    desc = (video_description or description or "").strip()
    return desc[:_MEMO_FRAMING_CAP]


def build_context_prompt(memo_groups: list[dict]) -> str:
    """Build the context block from memo groups — one citation index per memo,
    with that memo's framing (AI summary / description) and matched chunks
    stacked under it. Keeps [n] citations aligned with the source cards shown to
    the user (both are one-per-memo)."""
    context_parts = []
    for i, g in enumerate(memo_groups, 1):
        source_info = f"[{i}] {g['title']}"
        if g["domain"]:
            source_info += f" ({g['domain']})"
        pieces: list[str] = []
        framing = (g.get("framing") or "").strip()
        if framing:
            pieces.append(framing)
        # Append matched chunks, skipping any already covered by the framing
        # text (a short memo's only chunk can equal its description).
        for d in g["documents"]:
            d = (d or "").strip()
            if d and d not in framing:
                pieces.append(d)
        body = "\n\n".join(pieces)
        context_parts.append(f"{source_info}\n{body}\n")

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
        # Follow-ups: condense "and what about X?" into a standalone query for
        # RETRIEVAL only — the model still answers the user's original words.
        retrieval_query = query
        if history:
            retrieval_query = await condense_query(query, history, model)

        # Retrieve a CHUNK pool wider than the final memo cap, so collapsing to
        # distinct memos below still leaves several sources to cite.
        chunks = await search_similar(
            query=retrieval_query,
            workspace_id=workspace_id,
            collection_id=collection_id,
            memo_id=memo_id,
            n_results=settings.RAG_CANDIDATE_K,
        )

        # Hybrid leg: exact-word matches (titles + FTS5 content) join the pool
        # AFTER the vector chunks — supplementary, never displacing a closer
        # semantic hit. Scoped asks (one memo / one collection) skip it: their
        # pool is already pinned to the right memos.
        if not memo_id and not collection_id:
            vector_memo_ids = {
                c["metadata"].get("memo_id") for c in chunks if c["metadata"].get("memo_id")
            }
            chunks += await keyword_memo_chunks(retrieval_query, vector_memo_ids, workspace_id)

        # Drop ghost vectors AND hydrate the survivors in one load: a failed
        # Chroma purge can leave chunks whose memo is soft-deleted (citing them
        # 404s — plans/009), and each live memo's description / AI summary is
        # needed to frame its chunks (OPNMMO-0058). NULL is_deleted counts as
        # live, same idiom as memos.list_memos.
        memo_by_id = {}
        retrieved_ids = {c["metadata"].get("memo_id") for c in chunks if c["metadata"].get("memo_id")}
        if retrieved_ids:
            from sqlalchemy import select

            from backend.db.database import AsyncSessionLocal
            from backend.db.models import Memo

            async with AsyncSessionLocal() as db:
                rows = await db.execute(
                    select(Memo).where(
                        Memo.id.in_(retrieved_ids),
                        (Memo.is_deleted == False) | (Memo.is_deleted == None),  # noqa: E712, E711
                    )
                )
                memo_by_id = {m.id: m for m in rows.scalars()}
            chunks = [c for c in chunks if c["metadata"].get("memo_id") in memo_by_id]

        # Collapse chunks → distinct memos so the citation list is one card per
        # memo, capped at RAG_MAX_SOURCES (OPNMMO-0053). Order preserved =
        # nearest memo first; each memo keeps its best few chunks for context.
        sources = group_by_memo(
            chunks,
            max_memos=settings.RAG_MAX_SOURCES,
            max_chunks_per_memo=settings.RAG_CHUNKS_PER_MEMO,
        )

        # Frame each cited memo with its AI summary / description so the model
        # sees what the memo is about — not just the matched chunks — fixing Ask
        # calling video memos "just links" (OPNMMO-0058).
        for g in sources:
            m = memo_by_id.get(g["memo_id"])
            if m is not None:
                g["framing"] = memo_framing_text(
                    m.description, m.video_description, m.ai_summary
                )

        # Yield sources first so frontend can display them
        yield {
            "type": "sources",
            "data": [
                {
                    "memo_id": g["memo_id"],
                    "title": g["title"],
                    "domain": g["domain"],
                    "snippet": (g["documents"][0] if g["documents"] else "")[:200],
                    "distance": g["distance"],
                }
                for g in sources
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
