# Ollama in openMemo

Everything AI in openMemo runs through [Ollama](https://ollama.com) on your own machine. Chat, summaries, semantic search, image descriptions. No cloud, no API key, no telemetry. This page covers how it is wired, how to pick models, and what to do when something looks off.

## What needs what

| Feature | Model used | Set where |
|---|---|---|
| Ask Memo (chat + RAG) | Chat model | Settings → Local AI, or the dropdown in the Ask composer |
| AI Summary (3 modes) | Chat model | Same default as chat |
| Semantic search / related memos | Embedding model | `EMBED_MODEL` env |
| Image description on ingest | Vision model | `DEFAULT_VISION_MODEL` env |

## Picking the default model

Set it once in **Settings → Local AI → Default model**. That choice is saved server-side, so chat, Ask panels and summaries all use it. You can still pick a different model per conversation in the Ask page composer.

How openMemo resolves which model to call, in order:

1. The model picked for that conversation or request.
2. Your saved default from Settings.
3. The `DEFAULT_CHAT_MODEL` env value.
4. Any installed chat model, as a last resort.

Matching ignores case, so `qwen2.5:3b` finds `Qwen2.5:3b`. If you explicitly ask for a model that is not installed, you get a clear error with the exact `ollama pull` command instead of a silent failure.

## The embedding model and the search index

Memos are chunked and embedded into a local vector index (ChromaDB) the moment they get text: on ingest, on edit, after a transcript lands. Ask Memo retrieves from that index.

Two rules keep retrieval sharp:

- **The index only holds live memos.** Deleting a memo removes its chunks immediately. Restoring it re-embeds. You never get answers citing memos that no longer exist.
- **The index must match the model.** Embeddings from different models live in different vector spaces. If you change `EMBED_MODEL`, rebuild the index right after: **Settings → Local AI → Search index → Rebuild**. It re-embeds every memo with the current model and sweeps anything stale. Takes a moment per memo, all local.

nomic embed models get their required task prefixes (`search_document:` / `search_query:`) automatically. Without them retrieval is near-random, which is exactly how it used to feel before 2.3.0.

## How Ask Memo retrieves

- Top 8 chunks by cosine similarity (`RAG_TOP_K`).
- Chunks that are too far from the question (`RAG_MAX_DISTANCE`, default 0.80) are dropped instead of being stuffed into the prompt.
- Scoping is real: Ask from a memo page searches that memo, Ask from a collection searches that collection only.
- Nothing relevant found? openMemo says so honestly instead of letting the model improvise. Start your message with `@` to chat without memo context.
- Follow-up questions carry the conversation history, in RAG mode too.

## Context windows

Ollama defaults to a 4096-token window and silently cuts anything longer. openMemo requests 8192 (`OLLAMA_NUM_CTX`) so long transcripts and full RAG contexts survive. Raise it if your model and RAM allow more.

## Configuration reference

All optional, set in `backend/.env` (dev) or `docker-compose.yml` (Docker):

```bash
OLLAMA_HOST=http://localhost:11434
OLLAMA_HOSTS=http://localhost:11434,http://host.docker.internal:11434
EMBED_MODEL=nomic-embed-text-v2-moe:latest
DEFAULT_CHAT_MODEL=gemma4:e4b
DEFAULT_VISION_MODEL=gemma4:e4b
OLLAMA_NUM_CTX=8192
RAG_TOP_K=8
RAG_MAX_DISTANCE=0.80
```

`OLLAMA_HOSTS` is a fallback list. openMemo probes them in order and uses the first one that answers, so a laptop and a GPU box can share one config.

## Troubleshooting

**Summary button does nothing / errors.**
The error now shows inline under the button. Most common cause: the configured model is not installed. Run `ollama list`, then either pull the missing model or pick an installed one in Settings.

**Ask Memo answers feel random or cite deleted memos.**
Rebuild the index: Settings → Local AI → Search index → Rebuild. Mandatory after changing `EMBED_MODEL`, recommended once after upgrading past 2.2.x.

**"Ollama is not reachable."**
Start it (`ollama serve`, or the desktop app). The Settings → Local AI card shows live connection status. The rest of openMemo works fine with Ollama off; only AI features pause.

**Long videos summarize only the beginning.**
Raise `OLLAMA_NUM_CTX`. 8192 covers roughly a 20-minute talk; double it for long lectures if your hardware keeps up.

**Dev server uses wrong models.**
Config loads from `backend/.env` by absolute path since 2.3.0, so this is fixed. Just make sure the values in that file are models you actually have.
