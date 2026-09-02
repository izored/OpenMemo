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
| PDF rendering | pdf.js (`pdfjs-dist`), bundled and self-hosted |
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
- **CSS variable theming** — themes are driven by a `data-theme` **attribute** on `<html>` (`light` / `dark` / `hi`), not a `.dark` class and not `prefers-color-scheme`. Every surface, radius and shadow is a `var(--*)` token redefined per theme in `styles/openmemo.css`. This is why Tailwind's `dark:` variant never matches here and why third-party stylesheets that ship their own `prefers-color-scheme` blocks are not imported wholesale
- **A PDF memo renders its pages, not just its extracted text**: `frontend/src/components/PdfViewer.tsx`, lazy-loaded so its ~440 kB chunk only reaches a PDF memo. Drawn on our own canvas rather than in an `<iframe>`: the browser's built-in viewer ignores the theme, and nginx's CSP lists `frame-src https:` with no `'self'`, so it would be blocked in the container anyway. Three things keep it offline (ADR-025): the worker is imported through Vite so it emits as a same-origin asset, `scripts/copy-pdfjs-assets.mjs` copies pdf.js's CMaps, standard fonts, wasm decoders and ICC profiles into `public/pdfjs/` at build time (they default to a CDN otherwise), and `frontend/nginx.conf` maps `.mjs`, which nginx's bundled `mime.types` does not, so the worker is not served as `application/octet-stream` and refused by `nosniff`
- **yt-dlp self-updates on container start, not hard-pinned** — YouTube changes its player every few weeks and breaks older yt-dlp builds; image rebuilds happen far less often, so a hard pin guarantees the "Make it local" / YouTube ingest paths rot between rebuilds. Instead `requirements.txt` floor-pins (`yt-dlp>=2025.1.0`) and the backend Dockerfile entrypoint runs `pip install --upgrade yt-dlp` on each start (best-effort; failures are ignored when offline, and the whole step is skippable via `YTDLP_AUTOUPDATE=0`). Trade-off accepted: a few seconds of startup latency + nondeterministic yt-dlp version, in exchange for downloads that keep working without waiting on an image rebuild. The floor pin keeps a known-good baseline for offline/air-gapped deploys.

## Mesh (two-way device sync)

Optional, off by default, and inert until switched on in Settings. See
[ADR-024](ADR-024-MESH.md) for the decisions and [the handbook](MESH-HANDBOOK.md)
for the full picture.

Two lanes, at very different speeds:

| Lane | Size | Contents |
| --- | --- | --- |
| Metadata | ~7 MB | rows, transcripts, AI summaries, magnets |
| Media | ~25 GB | fetched from the original source, or the peer |

A Memo arrives complete, searchable and readable, long before its video does.

- `backend/core/mesh/` holds the whole feature. Around 3,000 lines, with roughly
  18 references to it in the rest of the backend. A contract sweep
  (`backend/tests/test_mesh_contract.py`) fails the build if that grows.
- **A separate listener on its own port.** Not a route on the app. The app has no
  authentication by design, so it must never face a network. The Mesh port
  serves one WebSocket and nothing else. It binds **loopback** until the user
  turns on *Reachable from your other computer*, which is also what makes an
  overlay address (Tailscale, WireGuard) reachable — mDNS does not leave the
  subnet, so a peer on another network is dialled by address.
- **Key material lives in the OS store**, not in `app_settings.json`: keychain on
  macOS, DPAPI on Windows, a `0600` file on Linux described as exactly that
  (`core/mesh/keystore.py`). The audit that prompted it is
  [MESH-SECURITY.md](MESH-SECURITY.md).
- **Change tracking is SQLite triggers**, created on enable and dropped on
  disable. They fire in the same transaction as the write they record, so the
  log cannot disagree with the data.
- **Ordering is a hybrid logical clock** kept in SQL, not wall time. Two
  machines with drifting clocks still agree on what happened first.
- **Merging is three-way** against the last agreed state, so edits to different
  fields merge silently and only a genuine clash reaches the user.
- **Every synced write is journalled and reversible**, with a database snapshot
  taken before each batch.

Adding a table or a Memo column fails a test until someone decides how it should
sync. Ordinary feature work needs no Mesh awareness, because the triggers sit
below the application and catch every write however it was made.

## Security

- Path traversal sanitized via whitelist (`a-zA-Z0-9_-`)
- File uploads validated by extension + magic bytes
- 50MB max file size
- FTS5 query escaping prevents MATCH injection
