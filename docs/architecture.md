# Architecture

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

## Security

- Path traversal sanitized via whitelist (`a-zA-Z0-9_-`)
- File uploads validated by extension + magic bytes
- 50MB max file size
- FTS5 query escaping prevents MATCH injection
