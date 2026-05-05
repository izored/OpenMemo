# OpenMemo — Technical Specification v1.5

**Codename:** `OpenMemo`  
**Spec Version:** `1.5`  
**Previous Version:** [`OpenMemo_Spec1.0.md`](OpenMemo_Spec1.0.md)  
**Stack:** Local-first, Ollama-backed, offline-capable  
**Target:** Web app (primary) + Browser Extension + Future Mobile

---

## Changelog: v1.0 → v1.5

This document supersedes v1.0. The following seven improvements were **fully implemented** beyond the original specification and are now the authoritative reference.

| # | Feature | Status in v1.0 | Status in v1.5 |
|---|---------|---------------|---------------|
| 1 | Streaming SSE for chat | Specified as WebSocket (optional) | **Implemented via SSE** |
| 2 | Background task queue for embeddings | Implied sync | **Implemented async queue** |
| 3 | Hybrid search at API level | Described as a goal | **Implemented (semantic + FTS5)** |
| 4 | `@` prefix RAG bypass | Listed as a future UX feature | **Implemented and documented** |
| 5 | File-type routing in ingestion | Described at high level | **Implemented with MIME dispatch** |
| 6 | Docker-compose with nginx reverse proxy | Basic compose only | **nginx proxy service added** |
| 7 | TypeScript throughout (0 errors) | TSX files mentioned | **Strict TS, 0 `tsc` errors** |

---

## 1. Product Definition

OpenMemo is an **AI-native knowledge OS** — not a note-taking app with AI bolted on. It passively ingests heterogeneous content, vectorizes it, and exposes a unified RAG chat interface (`AskMemo`) scoped to the user's personal corpus. The UI is card-driven, chronologically grouped, and organized into filterable views and Collections.

**Core Philosophy:**
- **Zero-effort capture:** Save first, organize never. The AI handles retrieval.
- **Grounded answers:** Every AI response cites source memos (articles, videos, notes, files).
- **Multi-modal corpus:** Text, images, PDFs, videos, audio, links, and screenshots coexist in one feed.
- **Reflective playback:** `MemoCast` turns recent saves into a digestible audio briefing.

---

## 2. Complete Feature Inventory

### 2.1 Content Ingestion (The "Memo" Pipeline)

| Content Type | Ingestion Method | AI Processing |
|---|---|---|
| **Web Articles** | Chrome extension 1-click, manual URL paste, bulk import | Crawl → HTML→Markdown → chunk → embed |
| **YouTube Videos** | URL paste, extension capture | Transcript extraction (yt-dlp) → chunk → embed |
| **PDFs** | Drag & drop, bulk upload (up to 50 files) | `pdfplumber` text extraction → chunk → embed |
| **DOC / DOCX** | Upload | `python-docx` text extraction → chunk → embed |
| **XLSX** | Upload | `openpyxl` table extraction → chunk → embed |
| **Images / Screenshots** | Drag & drop, paste, upload | Vision model captioning → embed caption + OCR |
| **Voice Notes** | In-app recorder | Whisper transcription → chunk → embed |
| **Plain Notes** | In-app editor | Direct embed |
| **X/Twitter Posts** | Extension 1-click | Text extraction → embed |
| **Gmail Emails** | Extension 1-click | Body text extraction → embed |
| **Reddit Posts/Comments** | Extension 1-click | Text extraction → embed |
| **ChatGPT Answers** | Extension 1-click | Text extraction → embed |

**v1.5 — File-Type Routing (Section 2.1a):**

The ingestion pipeline now has an explicit MIME/extension router before extraction:

```
[Uploaded file]
      │
      ▼
[MIME + extension inspect]
      │
  ┌───┴────────────────────────────────────────┐
  │ application/pdf          → pdfplumber       │
  │ application/vnd.openxml* → python-docx      │
  │ application/vnd.ms-excel → openpyxl         │
  │ image/*                  → vision model     │
  │ audio/*                  → Whisper          │
  │ text/* / fallback        → plain extractor  │
  └────────────────────────────────────────────┘
      │
      ▼
[Extracted text] → [Chunker] → [Background embed queue]
```

Routing is determined by `python-magic` MIME detection + file extension fallback to prevent misrouted uploads.

### 2.2 Core AI Features (AskMemo / MemoAI)

1. **Targeted Search:** Natural language query → hybrid search (semantic + full-text) → LLM synthesis with citations.
2. **Smart Advice:** Cross-memo synthesis drawing from articles, videos, and personal notes.
3. **Creative Writing:** Draft content in the user's voice citing saved sources.
4. **Per-Collection Chat:** Chat scoped to a single Collection's corpus.
5. **Model Switching:** User selects which Ollama model runs inference.
6. **`@` Prefix Command (RAG bypass):** Prefixing a message with `@` skips vector retrieval entirely and sends the query to the base LLM as a general knowledge question. The frontend detects the prefix and sets `bypass_rag: true` in the request payload.
7. **Vision Q&A:** Ask questions about uploaded images via a vision-capable Ollama model.
8. **AI Summary on Detail View:** One-click "AI Summary" generates a key-points card stored in `memos.ai_summary`.
9. **Note-from-Answer:** Create a new memo note directly from any AI chat response.

### 2.3 MemoCast (Audio Digest)

1. **Daily MemoCast:** Auto-generates a ~3-minute podcast script from memos saved in the last 24h.
2. **On-Demand Episode:** User selects N memos → AI writes podcast script → TTS → playable episode.
3. **Episode Player UI:** Cover art, title, date, progress bar, speed control (0.5x–2x), transcript tab.
4. **Memos in Episode:** Visual list of included memos with clickable cards.

### 2.4 Organization & UI

1. **Chronological Feed:** Grouped by date (e.g., "Aug 6, 2024 — 9 Memos").
2. **Filter Tabs:** `All | Notes | Images | Documents | Links | Videos | Audios`.
3. **View Toggles:** Grid view, List view, Timeline view.
4. **Smart Collections:** User-created folders; memos can belong to multiple collections.
5. **Tags:** Auto-extracted + manual; clicking a tag filters the feed.
6. **Related Memos:** Horizontal carousel showing semantically similar items.
7. **Bulk Actions:** Multi-select → add to collection, delete, export.
8. **Search Bar:** Hybrid full-text + semantic search (see Section 5.3).
9. **Sidebar Navigation:** Collapsible; shows Collections, Team Spaces, Settings.
10. **Memo Detail View:** Split-pane; left = content renderer; right = AskMemo chat.

---

## 3. UI/UX Design Specification

### 3.1 Design Tokens

- **Background:** `#FFFFFF` (main), `#F8F9FA` (sidebar), `#F3F4F6` (hover states).
- **Cards:** White surface, `border-radius: 16px`, subtle shadow `0 1px 3px rgba(0,0,0,0.08)`.
- **Typography:** System sans-serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`). Headings `font-weight: 600`.
- **Accent:** Warm amber/gold `#D97706` for CTAs and active states.
- **Type Badges:**
  - Notes: `#FEF3C7` (yellow)
  - Articles: `#E0F2FE` (light blue)
  - Videos: `#FEE2E2` (light red)
  - Images: `#F3E8FF` (light purple)
  - Audio: `#D1FAE5` (light green)
  - Files: `#F3F4F6` (gray)

### 3.2 `@` Prefix UX

When the user types `@` as the first character in the AskMemo input:
- A tooltip appears: _"General mode — bypassing your saved memos"_
- The send button changes to a globe icon
- The response header shows _"General Knowledge"_ instead of citing sources

---

## 4. Technical Architecture

### 4.1 High-Level Stack

| Layer | Technology | v1.5 Notes |
|---|---|---|
| **Frontend** | React 18 + Vite + TailwindCSS + shadcn/ui | **Full TypeScript, strict mode, 0 errors** |
| **State** | Zustand + TanStack Query | — |
| **Backend API** | FastAPI (Python, async) | — |
| **Vector DB** | ChromaDB (local persistent) | — |
| **Embeddings** | Ollama `nomic-embed-text` | **Async background queue (non-blocking)** |
| **LLM Inference** | Ollama local HTTP API | — |
| **Chat Streaming** | **SSE (Server-Sent Events)** | Replaces WebSocket proposal in v1.0 |
| **Search** | **Hybrid: ChromaDB + SQLite FTS5** | New in v1.5 |
| **Document Parsing** | `pdfplumber`, `python-docx`, `openpyxl`, `beautifulsoup4` | MIME-routed in v1.5 |
| **Audio** | `faster-whisper` | — |
| **TTS (MemoCast)** | `kokoro` / `piper` / browser `speechSynthesis` | — |
| **Database** | SQLite (metadata) + ChromaDB (vectors) | — |
| **Reverse Proxy** | **nginx** | New in v1.5 (Docker production) |
| **Chrome Ext** | Manifest V3, vanilla JS + content scripts | — |

### 4.2 Updated Data Flow Diagram (v1.5)

```
[User Input / File Drop]
        │
        ▼
[Ingestion Router]
        │
[MIME/Extension Dispatch] ──────────────────────────────────┐
        │                                                    │
[Extractor] → [Chunker] → [SQLite INSERT]                   │
                                  │                          │
                          [Background Task Queue] ◄──────────┘
                                  │
                          [Ollama Embed model]
                                  │
                          [ChromaDB upsert]
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              [Semantic Query]           [FTS5 Query]
                    │                           │
                    └─────────┬─────────────────┘
                              │
                      [Hybrid Re-rank]
                              │
                      [RAG Builder] ← (bypass if `@` prefix)
                              │
                      [Ollama LLM / stream=true]
                              │
                      [SSE token stream]
                              │
                      [React EventSource]
                              │
                    [Rendered response + citations]
```

### 4.3 Database Schema (SQLite — unchanged from v1.0)

```sql
users (id, email, name, avatar, created_at)
workspaces (id, name, owner_id, type, created_at)
memos (
  id, workspace_id, type,
  title, description, content_text, content_raw,
  source_url, source_domain, source_favicon,
  file_path, thumbnail_path,
  ai_summary, embedding_id,
  created_at, updated_at
)
collections (id, workspace_id, name, color, pinned, sort_order)
memo_collections (memo_id, collection_id)
tags (id, name)
memo_tags (memo_id, tag_id)
chat_sessions (id, workspace_id, collection_id, memo_id, title, model_used, created_at)
messages (id, session_id, role, content, sources_json, created_at)
memocasts (id, workspace_id, title, script_text, audio_path, duration, memos_json, created_at)
```

---

## 5. AI Integration Spec (v1.5)

### 5.1 Embedding Pipeline (Async — v1.5)

```
POST /api/ingest
  → validates file/URL
  → saves raw content to disk
  → INSERT into SQLite (status = "pending")
  → enqueues background task
  → returns 202 Accepted immediately

[Background Worker]
  → extracts text (MIME-routed)
  → chunks (512 tokens, 50 overlap)
  → calls Ollama /api/embed
  → upserts to ChromaDB
  → UPDATE SQLite status = "ready"
```

**Key change from v1.0:** Ingestion endpoint returns `202 Accepted` immediately. The frontend polls `GET /api/memos/{id}/status` or listens to a status SSE stream until `status == "ready"`.

### 5.2 RAG Chat Pipeline with SSE Streaming (v1.5)

```
POST /api/chat
  body: { query, session_id, scope, bypass_rag, model }

Server logic:
  1. If bypass_rag == true (@ prefix):
       skip steps 2–4, go directly to step 5 with no context
  2. Generate query embedding via Ollama
  3. Hybrid search (see 5.3):
       semantic results (ChromaDB, top-8) + FTS5 results (SQLite, top-8)
       → de-duplicate → re-rank → take top-8
  4. Build system prompt with retrieved context + citation map
  5. POST to Ollama /api/chat with stream: true
  6. Pipe response via SSE:
       data: {"token": "Hello", "done": false}
       data: {"token": " world", "done": false}
       data: {"citations": [...], "done": true}

Client (React):
  const es = new EventSource('/api/chat/stream?session_id=...')
  es.onmessage = (e) => appendToken(JSON.parse(e.data))
```

**Key change from v1.0:** v1.0 mentioned WebSockets as optional. v1.5 uses **SSE exclusively** because:
- SSE is unidirectional (server → client) which matches the streaming chat use case exactly
- Works natively through nginx `proxy_pass` without `upgrade` headers
- Browser-native `EventSource` requires no additional client library

### 5.3 Hybrid Search (v1.5)

```python
# GET /api/search?q=<query>&workspace_id=<id>

async def hybrid_search(query: str, workspace_id: str, top_k: int = 8):
    # Branch 1: Semantic (ChromaDB)
    query_embedding = await ollama_embed(query)
    semantic_results = chroma_collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where={"workspace_id": workspace_id}
    )

    # Branch 2: Full-text (SQLite FTS5)
    fts_results = db.execute(
        "SELECT memo_id, rank FROM memos_fts WHERE memos_fts MATCH ? "
        "AND workspace_id = ? ORDER BY rank LIMIT ?",
        [query, workspace_id, top_k]
    ).fetchall()

    # Merge: reciprocal rank fusion
    scores = {}
    for rank, r in enumerate(semantic_results["ids"][0]):
        scores[r] = scores.get(r, 0) + 1 / (60 + rank)
    for rank, r in enumerate(fts_results):
        scores[r.memo_id] = scores.get(r.memo_id, 0) + 1 / (60 + rank)

    merged = sorted(scores, key=scores.get, reverse=True)[:top_k]
    return fetch_memo_details(merged)
```

### 5.4 `@` Prefix — General Knowledge Fallback (v1.5)

When the user prefixes their message with `@`:
- Frontend strips the `@` character and sets `bypass_rag: true` in the request body.
- Backend skips embedding lookup and ChromaDB query entirely.
- System prompt changes to: _"You are a helpful AI assistant. Answer from your general knowledge."_
- Response has no `citations` field; frontend renders _"General Knowledge"_ badge.

This is distinct from the per-collection or global scoped RAG queries.

### 5.5 Summary Pipeline (unchanged from v1.0)

```
Input:  Full memo text
Prompt: "Extract 3-5 key insights. Return as bullet points."
Model:  qwen2.5:7b or mistral:7b
Output: Stored in memos.ai_summary
```

### 5.6 MemoCast Script Pipeline (unchanged from v1.0)

```
Input:  Array of memo texts from last 24h (or selected)
Prompt: "Write a 3-minute podcast script (~450 words)..."
Model:  llama3.3:70b or qwen2.5:32b
Output: script_text → TTS → audio file
```

---

## 6. Production Deployment (v1.5)

### 6.1 Docker-Compose with nginx Reverse Proxy

```yaml
# docker-compose.yml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
      - web

  api:
    build: ./backend
    expose:
      - "8000"
    volumes:
      - ./data:/app/data
      - ./files:/app/files
    environment:
      - OLLAMA_HOST=http://host.docker.internal:11434

  web:
    build: ./frontend
    expose:
      - "3000"

  chromadb:
    image: chromadb/chroma
    expose:
      - "8000"
    volumes:
      - ./chroma:/chroma/chroma
```

```nginx
# nginx.conf
server {
    listen 80;

    location /api/ {
        proxy_pass http://api:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE-specific: disable buffering so tokens stream immediately
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://web:3000/;
        proxy_set_header Host $host;
    }
}
```

**Key advantages over v1.0 basic compose:**
- Single exposed port (80); no direct backend port exposure.
- `proxy_buffering off` ensures SSE tokens are forwarded immediately without nginx buffering.
- CORS is a non-issue since all traffic is same-origin through nginx.
- Frontend assets can be served as static files from nginx in a further optimization.

### 6.2 Development (unchanged)

```bash
# Terminal 1
cd backend && uvicorn backend.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

---

## 7. TypeScript Specification (v1.5)

The entire frontend is written in strict TypeScript. The following rules are enforced:

```json
// tsconfig.json (relevant flags)
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

**Key typed interfaces:**

```typescript
// Memo entity
interface Memo {
  id: string;
  workspaceId: string;
  type: 'article' | 'note' | 'pdf' | 'image' | 'audio' | 'video' | 'link';
  title: string;
  description?: string;
  contentText?: string;
  sourceUrl?: string;
  aiSummary?: string;
  embeddingStatus: 'pending' | 'processing' | 'ready' | 'error';
  createdAt: string;
  updatedAt: string;
}

// Chat message with SSE streaming
interface ChatRequest {
  query: string;
  sessionId: string;
  scope: 'global' | 'collection' | 'memo';
  scopeId?: string;
  bypassRag: boolean;   // true when query starts with @
  model: string;
}

interface ChatToken {
  token?: string;
  citations?: Citation[];
  done: boolean;
}

// Search result (hybrid)
interface SearchResult {
  memoId: string;
  score: number;           // reciprocal rank fusion score
  matchType: 'semantic' | 'fulltext' | 'both';
  memo: Memo;
}
```

`tsc --noEmit` must pass with 0 errors before any merge to `main`.

---

## 8. Chrome Extension Specification (unchanged from v1.0)

**Manifest V3 Structure:**
```
chrome-extension/
├── manifest.json
├── background.js
├── content.js
├── sidepanel.html
├── popup.html
└── icons/
```

**API Endpoint:** `POST http://localhost:8000/api/extension/save`

---

## 9. File Structure (v1.5)

```
openmemo/
├── backend/
│   ├── main.py
│   ├── api/
│   │   ├── memos.py
│   │   ├── chat.py          # SSE streaming endpoint
│   │   ├── collections.py
│   │   ├── ingest.py        # Returns 202, enqueues background task
│   │   ├── search.py        # Hybrid search endpoint
│   │   └── export.py
│   ├── core/
│   │   ├── embedder.py      # Ollama embed calls (called from background worker)
│   │   ├── rag.py           # Retrieval + prompt builder + @ bypass
│   │   ├── chunker.py       # Text chunking (512 tokens, 50 overlap)
│   │   ├── extractor.py     # MIME-routed extractors
│   │   ├── task_queue.py    # Background task queue for async embedding
│   │   └── tts.py           # MemoCast audio generation
│   ├── db/
│   │   ├── models.py
│   │   └── chroma_client.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # All .tsx, strictly typed
│   │   │   ├── MemoCard.tsx
│   │   │   ├── MemoGrid.tsx
│   │   │   ├── AskMemo.tsx  # SSE EventSource consumer + @ prefix detection
│   │   │   ├── MemoDetail.tsx
│   │   │   ├── MemoCastPlayer.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/          # Zustand stores (typed)
│   │   └── lib/
│   │       ├── api.ts       # Typed API client
│   │       └── sse.ts       # SSE helper (EventSource wrapper)
│   ├── tsconfig.json        # strict: true
│   └── package.json
├── chrome-extension/
├── nginx.conf               # Production reverse proxy config
├── docker-compose.yml       # Includes nginx service
├── Specs/
│   ├── OpenMemo_Spec1.0.md
│   └── OpenMemo_Spec1.5.md  # This document
└── README.md
```

---

## 10. Recommended Ollama Models (unchanged from v1.0)

| Task | Recommended Model | Size |
|---|---|---|
| Fast Chat / Summary | `qwen2.5:7b` or `mistral:7b` | ~4–5 GB |
| Deep Reasoning | `llama3.3:70b` or `qwen2.5:32b` | ~40–45 GB |
| Vision | `llava:13b` or `gemma3:12b` | ~8–9 GB |
| Embeddings | `nomic-embed-text` | ~500 MB |
| Coding/Tool Use | `qwen2.5-coder:14b` | ~9 GB |
| Transcription | `whisper` (faster-whisper) | ~1.5 GB |

---

This specification represents the **as-built state** of OpenMemo v1.5. The architecture remains deliberately local-first: **SQLite + ChromaDB + Ollama** means zero cloud dependencies, zero API keys, and full data ownership. All v1.5 additions (SSE streaming, async embedding queue, hybrid search, `@` prefix bypass, MIME routing, nginx proxy, strict TypeScript) are production-ready implementations.
