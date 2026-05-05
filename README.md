# OpenMemo

A **local-first AI Knowledge OS** powered entirely by Ollama. Save articles, notes, files, videos, and more — then query your personal knowledge base with AI-powered RAG chat.

## Features

- **Zero-effort capture** — Save links, notes, PDFs, images, voice memos, and more
- **AI-powered search** — Hybrid semantic + full-text search across all your content
- **AskMemo (RAG Chat)** — Ask questions and get grounded answers with citations from your saved content
- **MemoCast** — Auto-generate podcast-style audio digests from your recent saves
- **Chrome Extension** — 1-click save from any webpage with site-specific extractors
- **100% Local** — No cloud, no API keys, full data ownership (Ollama + SQLite + ChromaDB)

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

### Docker (Alternative)

```bash
docker-compose up -d
```

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TailwindCSS |
| State | Zustand + TanStack Query |
| Backend | FastAPI (async Python) |
| Vector DB | ChromaDB (local) |
| Embeddings | Ollama `nomic-embed-text` |
| LLM | Ollama (any model) |
| Database | SQLite (metadata) |
| File Storage | Local filesystem |

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
├── frontend/         # React + Vite frontend
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Route pages
│       ├── stores/      # Zustand state
│       └── lib/         # API client, utilities
├── chrome-extension/ # Manifest V3 browser extension
└── docker-compose.yml
```

## License

MIT
