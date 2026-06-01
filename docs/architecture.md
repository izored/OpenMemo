# Architecture

> Deep dives: **[Audio Memo Handbook](AUDIO_MEMO_HANDBOOK.md)** — the full reference
> for the audio stack (playback, recording, transcription, "Make it local"),
> decisions log, and V2 roadmap.

## Overview

OpenMemo is a local-first AI knowledge base. Everything runs on your machine — your data never leaves your computer.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Chrome    │     │   React     │     │   FastAPI   │
│ Extension   │◄────┤  Frontend   │◄────┤   Backend   │
│             │     │   (Vite)    │     │             │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                   │
                    ┌──────┴──────┐     ┌──────┴──────┐
                    │   nginx     │     │   SQLite    │
                    │  (reverse)  │     │  (metadata) │
                    └─────────────┘     └─────────────┘
                                          │
                                    ┌─────┴─────┐
                                    │  ChromaDB │
                                    │(embeddings)│
                                    └───────────┘
                                          │
                                    ┌─────┴─────┐
                                    │   Ollama  │
                                    │  (LLMs)   │
                                    └───────────┘
```

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 + Vite |
| State | Zustand + TanStack Query |
| Backend | FastAPI (Python 3.12) + SQLAlchemy 2.0 (async) |
| Database | SQLite (via aiosqlite) |
| Vector DB | ChromaDB (local persistent) |
| LLM/Embed | Ollama (local) |
| Reverse Proxy | nginx |

## Data Flow

1. **Save** — URL, file, or note goes to `POST /api/ingest/*`
2. **Extract** — Backend scrapes text, generates thumbnails, detects type
3. **Chunk & Embed** — Text is split into chunks, embeddings generated via `nomic-embed-text`
4. **Store** — Chunks go to ChromaDB; metadata goes to SQLite
5. **Search** — FTS5 for keyword search, ChromaDB for semantic search
6. **Chat** — AskMemo uses RAG to answer questions about your memos

## Key Design Decisions

- **UUID string PKs** everywhere — no auto-increment integers
- **Single-tenant default** — one auto-created user + workspace
- **File ownership check** — `/api/files/{path}` verifies the memo exists before serving
- **Async everywhere** — ChromaDB ops wrapped in `asyncio.to_thread()`
- **CSS variable theming** — light/dark via `html.dark` class + CSS custom properties
- **yt-dlp self-updates on container start, not hard-pinned** — YouTube changes its player every few weeks and breaks older yt-dlp builds; image rebuilds happen far less often, so a hard pin guarantees the "Make it local" / YouTube ingest paths rot between rebuilds. Instead `requirements.txt` floor-pins (`yt-dlp>=2025.1.0`) and the backend Dockerfile entrypoint runs `pip install --upgrade yt-dlp` on each start (best-effort; failures are ignored when offline, and the whole step is skippable via `YTDLP_AUTOUPDATE=0`). Trade-off accepted: a few seconds of startup latency + nondeterministic yt-dlp version, in exchange for downloads that keep working without waiting on an image rebuild. The floor pin keeps a known-good baseline for offline/air-gapped deploys.

## Security

- Path traversal sanitized via whitelist (`a-zA-Z0-9_-`)
- File uploads validated by extension + magic bytes
- 50MB max file size
- FTS5 query escaping prevents MATCH injection
