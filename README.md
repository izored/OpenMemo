# OpenMemo
> **Spec Version: 1.5** — See [`Specs/OpenMemo_Spec1.5.md`](Specs/OpenMemo_Spec1.5.md) for full technical specification.

A **local-first AI Knowledge OS** powered entirely by Ollama. Save articles, notes, files, videos, and more — then query your personal knowledge base with AI-powered RAG chat.

## Features

- **Zero-effort capture** — Save links, notes, PDFs, images, voice memos, and more
- **AI-powered search** — Hybrid semantic + full-text search across all your content
- **AskMemo (RAG Chat)** — Ask questions and get grounded answers with citations from your saved content
- **Streaming chat** — Real-time SSE (Server-Sent Events) streaming for instant AI response feedback
- **`@` prefix fallback** — Type `@` to bypass RAG and query the LLM's general knowledge directly
- **MemoCast** — Auto-generate podcast-style audio digests from your recent saves
- **Chrome Extension** — 1-click save from any webpage with site-specific extractors
- **100% Local** — No cloud, no API keys, full data ownership (Ollama + SQLite + ChromaDB)
- **TypeScript frontend** — Fully typed React codebase with 0 build errors

## Quick Start

### Prerequisites

1. **Ollama** installed and running ([ollama.ai](https://ollama.ai))
2. **Python 3.11+**
3. **Node.js 18+**

### Pull required models

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
# Optional:
ollama pull llava:13b        # for image understanding
ollama pull llama3.3:70b     # for deeper reasoning
```

### Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate     # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

### Docker (Production — with nginx reverse proxy)

```bash
docker-compose up -d
```

The compose stack includes an **nginx reverse proxy** that routes `/api` to the FastAPI backend and `/` to the React frontend — no CORS configuration needed in production.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TailwindCSS (**TypeScript, 0 errors**) |
| State | Zustand + TanStack Query |
| Backend | FastAPI (async Python) |
| Vector DB | ChromaDB (local) |
| Embeddings | Ollama `nomic-embed-text` (async background queue) |
| LLM | Ollama (any model) |
| Search | **Hybrid: ChromaDB semantic + SQLite FTS5 full-text** |
| Chat Streaming | **Server-Sent Events (SSE)** |
| Database | SQLite (metadata) |
| File Storage | Local filesystem |
| Reverse Proxy | **nginx** (Docker production) |

## v1.5 Improvements (Beyond Original Spec)

The following features were implemented beyond the original v1.0 specification:

| # | Improvement | Description |
|---|-------------|-------------|
| 1 | **Streaming SSE for chat** | AskMemo chat streams tokens via Server-Sent Events (SSE), not WebSockets. Lower overhead, browser-native `EventSource`, works through nginx without special config. |
| 2 | **Background task queue for embeddings** | Ingestion returns immediately; embeddings are computed asynchronously via a background task queue. No blocking on large files. |
| 3 | **Hybrid search at the API level** | `/api/search` merges ChromaDB vector results with SQLite FTS5 full-text results, re-ranked by a combined score, before returning to the client. |
| 4 | **`@` prefix for general knowledge fallback** | Prefixing a chat message with `@` bypasses the RAG pipeline and sends the query directly to the LLM as a general knowledge question. Documented in the AskMemo UI. |
| 5 | **File-type routing in ingestion pipeline** | The ingestion router inspects MIME type and extension to dispatch files to the correct extractor: PDF → `pdfplumber`, DOCX → `python-docx`, XLSX → `openpyxl`, images → vision model, audio → Whisper. |
| 6 | **Docker-compose with nginx reverse proxy** | Production `docker-compose.yml` adds an nginx service that proxies all traffic — no exposed backend port, clean single-origin setup, static frontend served from nginx. |
| 7 | **TypeScript throughout with clean build** | The entire frontend is written in TypeScript with strict mode. `tsc --noEmit` passes with 0 errors. |

## Chrome Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `chrome-extension/` folder
4. Click the OpenMemo icon to save any page

## Project Structure

```
openmemo/
├── backend/          # FastAPI Python backend
│   ├── api/          # Route handlers (memos, chat, ingest, etc.)
│   ├── core/         # Business logic (RAG, embedder, extractor, TTS)
│   └── db/           # Database models and clients
├── frontend/         # React + Vite + TypeScript frontend
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Route pages
│       ├── stores/      # Zustand state
│       └── lib/         # API client, utilities
├── chrome-extension/ # Manifest V3 browser extension
├── Specs/
│   ├── OpenMemo_Spec1.0.md   # Original specification
│   └── OpenMemo_Spec1.5.md   # Current specification (this release)
└── docker-compose.yml
```

## License

MIT
