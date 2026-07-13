# ADR-022: Ask Memo, Ask this memo, and the RAG flow

**Date:** 2026-07-13 · **Updated:** 2026-07-13 (hybrid retrieval + follow-up condensation) · **Status:** Shipped · **Builds on:** ADR-014 (resilient Ollama integration), ADR-007 (one predicate gates AI features)

This is the locked reference for how a question travels from the composer to Ollama and back. Every prompt we send is written here verbatim. When we improve retrieval, we change this document in the same PR. No silent drift.

## Context

Ask Memo grew in pieces. Library RAG first, then single-memo chat, then collection scoping, then the Memos/Chat toggle. The logic lived only in code (`backend/core/rag.py`, `backend/core/embedder.py`, `backend/api/chat.py`) and nobody could answer "what exactly does the model see?" without reading all three files. OPNMMO-0053 made the cost visible: retrieval returned 8 chunk-cards of the same memo and looked broken, and there was no written flow to check it against.

## Decision

**One pipeline, three entry modes, all prompts and caps recorded here.**

### The three modes

| Mode | Trigger | Context fed to the model |
|---|---|---|
| **Library RAG** | Ask page, Memos toggle (default) | Top chunks from the whole vector index, collapsed to distinct memos |
| **Single memo** | "Ask this memo" on a memo page | The WHOLE memo: metadata header + description + transcript/extracted text |
| **Plain chat** | Ask page, Chat toggle (or legacy `@` prefix) | Nothing of yours. Straight to the model |

Collection scoping is library RAG with a filter: retrieval only searches chunks whose memo lives in that collection.

### How memos become searchable (write path)

1. A memo gets text on ingest, on edit, or when a transcript lands.
2. `chunk_text()` splits it: `CHUNK_SIZE=384` tokens per chunk, `CHUNK_OVERLAP=64`, sentence-boundary aware. 384 leaves headroom inside nomic's 512-token window for the task prefix. Overflowing chunks get silently truncated by Ollama, so we never let them overflow.
3. Each chunk is embedded with `EMBED_MODEL`. nomic models get their required task prefixes, `search_document: ` for chunks and `search_query: ` for questions. The prefix is for embedding only, stored chunk text stays clean. Without prefixes nomic retrieval is near-random (ADR-014).
4. Chunks land in ChromaDB with metadata: `memo_id`, `workspace_id`, `type`, `title`, `source_domain`, `chunk_index`. Old chunks for the memo are deleted first, so a shorter re-embed never leaves stale tails.
5. The index only holds live memos. Delete removes chunks, restore re-embeds.

### Library RAG (read path, OPNMMO-0053 shape + hybrid)

1. **Condense follow-ups.** When the session has history, one cheap LLM call rewrites the question into a standalone retrieval query ("and the price?" becomes "toyota hilux price"). Retrieval uses the rewrite; the answering model still gets the user's original words. Any failure or a suspicious rewrite (empty, over 300 chars, `<think>` residue) falls back to the raw question.
2. Embed the retrieval query (`search_query: ` prefix when nomic).
3. Pull a candidate pool of `RAG_CANDIDATE_K=16` chunks by cosine distance, scoped by collection when asked from one.
4. Drop chunks farther than `RAG_MAX_DISTANCE=0.80`. Beyond that they are topic noise.
5. **Hybrid keyword leg** (library-wide asks only, scoped asks skip it): FTS5 over titles + content finds memos by exact words. Keyword-matched memos the vector pool missed get their best chunks pulled from Chroma with the distance cutoff DISABLED — an exact name match earns its seat even when its embedding sits far away. A keyword memo with no vectors at all (embed failed or pending) joins as a title+preview pseudo-chunk instead of being silently dropped. Keyword chunks append AFTER the vector pool: supplementary, never displacing a closer semantic hit.
6. Drop ghost chunks whose memo is soft-deleted (plans/009), across both legs. A failed Chroma purge must never produce a citation that 404s.
7. **Collapse chunks to distinct memos** (`group_by_memo`): keep up to `RAG_CHUNKS_PER_MEMO=2` best chunks per memo, cap the list at `RAG_MAX_SOURCES=5` memos, nearest memo first. One citation card per memo. This is the fix for "8 Toyota memos" that were really 2.
8. Stream the source list to the UI first (the "Reading N memos" state), then build the prompt.
9. Nothing survived the cuts? Stream `NO_CONTEXT_MESSAGE` verbatim, no LLM call. Honest and instant beats hallucination.

The context block the model sees:

```
---
CONTEXT FROM USER'S MEMOS:

[1] {title} ({domain})
{chunk}

{chunk}

[2] {title}
{chunk}
---

Question: {query}
```

Citation indexes `[n]` in the block match the source cards one to one, both are one per memo.

### Single memo ("Ask this memo")

No retrieval. The memo page already shows everything, so the model gets everything the page shows:

- A metadata header: `Title / Artist / Album / Source / Type` (whatever exists).
- `DESCRIPTION:` block when the memo has one (deduped if identical to the body).
- `TRANSCRIPT:` or `CONTENT:` block, the transcript label only when transcription is done.
- The whole thing capped at `_MEMO_CONTEXT_CAP=24000` chars to fit local context windows.

A memo with no body yet (a fresh song, an unpulled link) is a **thin memo**: the header alone is the context and the model gets the softer thin-memo prompt below, which allows general knowledge (OPNMMO-0045). A full body keeps the strict context-only prompt.

Context wrapper: `---\nCONTEXT FROM THIS MEMO:\n\n{header + body}\n---` followed by `Question: {query}`.

### The prompts, verbatim

**Library RAG and full-body single memo** (`SYSTEM_PROMPT`):

> You are MemoAI, a helpful assistant that answers questions using ONLY the provided context from the user's saved memos (articles, notes, videos, documents, etc.).
>
> Rules:
> 1. Answer based ONLY on the provided context. Do not use external knowledge.
> 2. Cite sources using [1], [2], etc. format, corresponding to the provided sources.
> 3. If the context doesn't contain enough information to answer, say so honestly.
> 4. Be concise and helpful. Provide structured answers when appropriate.
> 5. When multiple sources discuss the same topic, synthesize them into a coherent answer.

**Thin memo** (`THIN_MEMO_SYSTEM_PROMPT`):

> You are MemoAI, answering about one saved memo. The only details available are the memo's title and basic metadata below, there is no transcript or extracted text. Use the title and metadata together with your own general knowledge to give a helpful answer: identify what it likely refers to, give relevant background, and answer the question. Be honest about what is inferred from the title versus known fact, and keep it concise.

**Plain chat** (`GENERAL_SYSTEM_PROMPT`):

> You are MemoAI, a helpful general-purpose assistant. Answer the user's question to the best of your ability.

**Empty retrieval** (`NO_CONTEXT_MESSAGE`, streamed as the answer, no LLM call):

> I couldn't find anything in your memos relevant to that question. Try rephrasing it, or switch the composer to **Chat** mode to talk to the model without your memos.

**Follow-up condensation** (`CONDENSE_SYSTEM_PROMPT`, retrieval-only pre-call):

> You rewrite a follow-up question as one standalone search query. Use the conversation to resolve pronouns and references. Return ONLY the rewritten query, nothing else, no quotes, no explanation. If the question is already standalone, return it unchanged.

The user turn is `Conversation:\n{last 4 messages, 300 chars each}\n\nFollow-up question: {query}\n\nStandalone search query:`. `<think>` blocks from reasoning models are stripped from the reply.

### Message assembly, every mode

```
[ system prompt ]
[ up to the last 6 saved messages of this session ]   <- history BEFORE the context turn
[ user: {context block}\n\nQuestion: {query} ]        <- context rides the current turn only
```

History goes before the context turn so follow-ups ("and what about X?") keep working in RAG mode. The just-saved user message is excluded from history, the question would otherwise reach the model twice. Context is never persisted into history, each turn re-retrieves, so answers track index changes.

Model resolution and `num_ctx=8192` follow ADR-014. Responses stream over SSE as `sources -> token* -> done`, failures stream as an `error` event the UI shows instead of an empty bubble.

### Tuning knobs (all env, `backend/.env`)

| Setting | Default | Meaning |
|---|---|---|
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | 384 / 64 | Chunking geometry (tokens) |
| `RAG_CANDIDATE_K` | 16 | Chunk pool pulled before dedup |
| `RAG_MAX_SOURCES` | 5 | Distinct memos shown and cited |
| `RAG_CHUNKS_PER_MEMO` | 2 | Chunks per memo fed to the model |
| `RAG_MAX_DISTANCE` | 0.80 | Cosine distance ceiling |
| `RAG_TOP_K` | 8 | Legacy top-k, still used by semantic search + related memos |
| `OLLAMA_NUM_CTX` | 8192 | Context window requested from Ollama |

## Consequences

- Anyone can now answer "what does the model see?" from this page alone. Prompt edits must update this file in the same change.
- Citations are honest: five cards means five memos. A memo dominating the pool costs it nothing, its best two chunks still represent it.
- The distance cutoff is the current weak point. 0.80 is lenient, and a weakly related memo (a README that mentions the topic once) can still ride in as a low-value source. Tighten per corpus, or move to a relative cutoff (drop sources much farther than the best hit).
- ~~The chat path is pure vector search~~ **Shipped 2026-07-13:** hybrid retrieval merges an FTS5 keyword leg into the candidate pool, so exact names no longer lean on the embed model alone.
- ~~Follow-ups are not condensed~~ **Shipped 2026-07-13:** follow-ups are rewritten into standalone retrieval queries when history exists. Costs one extra model call per follow-up turn; the "Searching your memos" status covers the latency.
- **Remaining gap, tracked for later:** temporal questions ("what did I save this week?") still retrieve by phrase similarity, not by date. A query router that swaps in a structured recent-memos context block fits this flow without changing its shape.
