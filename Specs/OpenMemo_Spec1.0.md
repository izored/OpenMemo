Here is a technical specification to build a **1:1 local clone of MyMemo** (never reference the name from now on, only use the codename of the spec, powered entirely by Ollama models. This spec covers every feature, screen, interaction, and AI pipeline extracted from the live product.

---

# Local — Technical Specification
**Codename:** `OpenMemo`  
**Stack:** Local-first, Ollama-backed, offline-capable  
**Target:** Web app (primary) + Browser Extension + Future Mobile

---

## 1. Product Definition (What MyMemo Actually Is)

MyMemo is an **AI-native knowledge OS** — not a note-taking app with AI bolted on. It passively ingests heterogeneous content, vectorizes it, and exposes a unified RAG chat interface (`AskMemo`) scoped to the user's personal corpus. The UI is card-driven, chronologically grouped, and organized into filterable views and Collections.

**Core Philosophy to Replicate:**
- **Zero-effort capture:** Save first, organize never. The AI handles retrieval.
- **Grounded answers:** Every AI response cites source memos (articles, videos, notes, files).
- **Multi-modal corpus:** Text, images, PDFs, videos, audio, links, and screenshots coexist in one feed.
- **Reflective playback:** `MemoCast` turns recent saves into a digestible audio briefing.

---

## 2. Complete Feature Inventory (1:1 Mapping)

### 2.1 Content Ingestion (The "Memo" Pipeline)
| Content Type | Ingestion Method | AI Processing Required |
|---|---|---|
| **Web Articles** | Chrome extension 1-click, manual URL paste, bulk import | Crawl → HTML→Markdown → chunk → embed |
| **YouTube Videos** | URL paste, extension capture | Transcript extraction (whisper/yt-dlp) → chunk → embed |
| **PDFs** | Drag & drop, bulk upload (up to 50 files) | OCR + text extraction → chunk → embed |
| **DOC / DOCX / XLSX** | Upload | Text/table extraction → chunk → embed |
| **Images / Screenshots** | Drag & drop, paste, upload | Vision model captioning (Ollama vision model) → embed caption + OCR text |
| **Voice Notes** | In-app recorder | Whisper transcription → chunk → embed |
| **Plain Notes** | In-app editor | Direct embed |
| **X/Twitter Posts** | Extension 1-click | Text extraction → embed |
| **Gmail Emails** | Extension 1-click | Body text extraction → embed |
| **Reddit Posts/Comments** | Extension 1-click | Text extraction → embed |
| **ChatGPT Answers** | Extension 1-click | Text extraction → embed |
| **Pocket Import** | Bulk import (beta feature) | Parse → extract → chunk → embed |

**Derived Local Feature:** A "Drop Zone" on the web app that accepts any file or URL and routes it to the correct ingestion pipeline.

### 2.2 Core AI Features (AskMemo / MemoAI)
1. **Targeted Search:** Natural language query → vector search top-k → LLM synthesis with citations. Example: *"What have I uploaded about marketing strategy?"*
2. **Smart Advice:** Cross-memo synthesis. Example: *"How to raise funds as a founder?"* pulls from articles + videos + personal notes.
3. **Creative Writing:** Draft content in the user's voice, citing their saved sources.
4. **Per-Collection Chat:** Chat history scoped to a single Collection, not the global knowledge base.
5. **Model Switching:** User selects which Ollama model runs the inference (e.g., `llama3.3`, `qwen2.5`, `mistral`, `gemma3`, vision models).
6. **"@" Command:** Escape hatch to query the base LLM without RAG context (general knowledge fallback).
7. **Vision Q&A:** Ask questions about uploaded images. Requires a vision-capable Ollama model.
8. **AI Summary on Detail View:** Every memo has a one-click "AI Summary" button that generates a key-points card.
9. **Note-from-Answer:** Create a new memo note from any AI chat response.

### 2.3 MemoCast (Audio Digest)
1. **Daily MemoCast:** Auto-generates a ~3-minute podcast script from memos saved in the last 24h.
2. **On-Demand Episode:** User selects N memos → AI writes a podcast script → TTS (local Piper/kokoro or browser SpeechSynthesis) → playable episode.
3. **Episode Player UI:** Cover art, title, date, progress bar, speed control (0.5x–2x), transcript tab.
4. **Memos in Episode:** Visual list of which memos were included, with clickable cards.

### 2.4 Organization & UI
1. **Chronological Feed:** Grouped by date (e.g., "Aug 6, 2024 — 9 Memos").
2. **Filter Tabs:** `All | Notes | Images | Documents | Links | Videos | Audios`.
3. **View Toggles:** Grid view (cards), List view (compact rows), Timeline view.
4. **Smart Collections:** User-created folders. Memos can belong to multiple collections. Collections pin to sidebar. Reorderable.
5. **Tags:** Auto-extracted + manual. Clicking a tag filters the feed.
6. **Related Memos:** Horizontal carousel at bottom of memo detail showing semantically similar items.
7. **Bulk Actions:** Multi-select in list view → add to collection, delete, export.
8. **Search Bar:** Full-text + semantic hybrid search across all memos.
9. **Sidebar Navigation:** Collapsible. Shows Collections, Team Spaces, Settings.
10. **Memo Detail View:** Split-pane layout. Left = rendered content (article reader, PDF viewer, video embed, image viewer). Right = `AskMemo` chat scoped to this single memo.

### 2.5 TeamSpace (Collaboration)
1. **Workspaces:** Separate knowledge bases per team/project.
2. **Roles:** Owner, Editor, Member.
3. **Shared Memos:** Any memo can be shared into a TeamSpace.
4. **Shared AI Chat:** Team-scoped AskMemo queries only that workspace's corpus.

### 2.6 Chrome Extension
1. **1-Click Save:** Context menu + toolbar button. Captures page title, URL, body text, favicon.
2. **Side Panel:** When reading an article, opens a side panel showing the AI summary of that page alongside the original.
3. **Workspace Selector:** Choose which collection/workspace to save into.
4. **Special Extractors:** Dedicated parsers for YouTube, X/Twitter, Gmail, Reddit, ChatGPT conversations.
5. **Screenshot Capture:** Capture visible area or full page as image memo.

### 2.7 Export & Portability
1. **Markdown Export:** Any memo or collection exports to `.md`.
2. **PDF/Word Export:** AI summaries and chat transcripts export to document.
3. **Bulk Export:** Select multiple → zip of markdowns.

---

## 3. UI/UX Design Specification (1:1 Visual Clone)

### 3.1 Design Tokens
- **Background:** `#FFFFFF` (main), `#F8F9FA` (sidebar), `#F3F4F6` (hover states).
- **Cards:** White surface, `border-radius: 16px`, subtle shadow `0 1px 3px rgba(0,0,0,0.08)`.
- **Typography:** System sans-serif stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`). Headings `font-weight: 600`.
- **Accent:** Warm amber/gold `#D97706` for CTAs and active states.
- **Type Badges:** Pastel color coding per content type:
  - Notes: `#FEF3C7` (yellow)
  - Articles: `#E0F2FE` (light blue)
  - Videos: `#FEE2E2` (light red)
  - Images: `#F3E8FF` (light purple)
  - Audio: `#D1FAE5` (light green)
  - Files: `#F3F4F6` (gray)

### 3.2 Screen Layouts

#### A. Main Feed (Dashboard)
```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]  MyMemo                             [🔍 Search] [👤]│
├──────────┬──────────────────────────────────────────────────┤
│          │  [All] [Notes] [Images] [Docs] [Links] [Videos]  │
│  📁 Coll1│                                                  │
│  📁 Coll2│  August 6, 2024 — 9 Memos                        │
│  📁 Coll3│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│          │  │ Audio   │ │ Note    │ │ Image   │ │ Video   │ │
│  ────────│  │ Card    │ │ Card    │ │ Card    │ │ Card    │ │
│  Team    │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│  Spaces  │                                                  │
│          │  August 5, 2024 — 3 Memos                        │
│          │  ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│          │  │ Link    │ │ Screenshot│ │ PDF    │            │
│          │  └─────────┘ └─────────┘ └─────────┘             │
│          │                                                  │
│  [⚙️]    │  [➕] FAB (Add New)                              │
└──────────┴──────────────────────────────────────────────────┘
```

**Card Anatomy:**
- **Top:** Thumbnail/preview image (if available) or icon.
- **Middle:** Title (2-line clamp), AI-generated 1-line description.
- **Bottom:** Source favicon + domain, Type badge, Date.
- **Hover:** Quick-action overlay (Ask, Add to Collection, Delete).

#### B. Memo Detail + AskMemo (Split Pane)
```
┌─────────────────────────────────────────────────────────────┐
│ [←]  Share  [💬] [📋] [🏷️] [⋯]        │  AskMemo           │
│                                        │                    │
│  [CONTENT RENDERER]                    │  ┌──────────────┐  │
│  (Article reader / PDF viewer /        │  │ User Q       │  │
│   Video embed / Image viewer)          │  └──────────────┘  │
│                                        │  ┌──────────────┐  │
│  Title                                 │  │ AI Response  │  │
│  Date • Tags                           │  │ with inline  │  │
│                                        │  │ citations    │  │
│  ┌─────────────────────────────────┐   │  │ [source 1]   │  │
│  │ AI Summary Box (amber border)   │   │  │ [source 2]   │  │
│  │ Key points extracted...         │   │  └──────────────┘  │
│  └─────────────────────────────────┘   │                    │
│                                        │  [Chat input     ] │
│  Related Memos → → →                   │  [↑]               │
└─────────────────────────────────────────────────────────────┘
```

#### C. MemoCast Player
```
┌───────────────────────────────────────┐
│ [←]              Share  [⋯]           │
│                                       │
│  ┌────────────────────────────────┐   │
│  │      [Cover Art Image]         │   │
│  │   EP 3 | AI toys and its...    │   │
│  │      [MemoCast Setting]        │   │
│  └────────────────────────────────┘   │
│                                       │
│  ◀  0:10 ═══════════════════════ 5:06 │
│                                       │
│  Memos in this episode                │
│  ┌─────────┐ ┌─────────┐              │
│  │ Note    │ │ Article │              │
│  └─────────┘ └─────────┘              │
│                                       │
│  ┌────────────────────────────────┐   │
│  │ Transcript                     │   │
│  │ When it comes to artificial    │   │
│  │ intelligence...                │   │
│  └────────────────────────────────┘   │
└───────────────────────────────────────┘
```

#### D. Add New Modal
- Tabs: `Link | Note | File | Voice`
- Link tab: URL input → auto-preview fetch → Collection selector → Save.
- Note tab: Markdown editor with toolbar.
- File tab: Drag zone + file picker.
- Voice tab: Record button → waveform visualizer → Stop → Transcript preview → Save.

---

## 4. Technical Architecture (Local-First / Ollama Stack)

### 4.1 High-Level Stack
| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TailwindCSS + shadcn/ui |
| **State** | Zustand (client) + TanStack Query (server state) |
| **Backend API** | FastAPI (Python) — async, local, no cloud dependency |
| **Vector DB** | ChromaDB (local persistent) or Qdrant (local Docker) |
| **Embeddings** | Ollama `nomic-embed-text` or `mxbai-embed-large` |
| **LLM Inference** | Ollama (local HTTP API) — `llama3.3`, `qwen2.5`, `mistral`, etc. |
| **Vision** | Ollama vision model (e.g., `llava`, `bakllava`, `gemma3`) |
| **Document Parsing** | `marker` (PDF→Markdown), `python-docx`, `openpyxl`, `beautifulsoup4` |
| **Audio** | `whisper.cpp` (via Ollama or direct) or `faster-whisper` |
| **YouTube** | `yt-dlp` (extract metadata + subtitles) |
| **TTS (MemoCast)** | `kokoro` (local) or `piper` or browser `speechSynthesis` |
| **Database** | SQLite (metadata, users, collections) + ChromaDB (vectors) |
| **File Storage** | Local filesystem (`~/OpenMemo/files/`) |
| **Chrome Ext** | Manifest V3, vanilla JS + content scripts |

### 4.2 Data Flow Diagram
```
[User Input] → [Ingestion Router] → [Extractor]
                                          ↓
[File Store] ← [Chunker] ← [Cleaner/Converter]
     ↓              ↓
[Ollama Embed] → [ChromaDB] ← [Metadata] → [SQLite]
     ↑                                      ↓
[Ollama LLM] ← [RAG Builder] ← [Query] ← [FastAPI]
     ↓
[Response + Citations] → [React Frontend]
```

### 4.3 Database Schema (SQLite)

```sql
-- Users
users (id, email, name, avatar, created_at)

-- Workspaces
workspaces (id, name, owner_id, type ['personal','team'], created_at)

-- Memos (the core entity)
memos (
  id, workspace_id, type, 
  title, description, content_text, content_raw, -- raw = markdown/html
  source_url, source_domain, source_favicon,
  file_path, -- local path if uploaded file
  thumbnail_path,
  ai_summary, -- generated summary text
  embedding_id, -- reference to ChromaDB doc ID
  created_at, updated_at
)

-- Collections
collections (id, workspace_id, name, color, pinned, sort_order)

-- Memo-Collection join
memo_collections (memo_id, collection_id)

-- Tags
tags (id, name)
memo_tags (memo_id, tag_id)

-- Chat Sessions
chat_sessions (id, workspace_id, collection_id, memo_id, title, model_used, created_at)

-- Messages
messages (id, session_id, role, content, sources_json, created_at)

-- MemoCast Episodes
memocasts (id, workspace_id, title, script_text, audio_path, duration, memos_json, created_at)
```

### 4.4 ChromaDB Schema
```python
collection = client.get_or_create_collection("memos")

# Each chunk stored:
# ids: ["memo_{memo_id}_chunk_{i}"]
# documents: [chunk_text]
# metadatas: [{
#   "memo_id": "uuid",
#   "workspace_id": "uuid",
#   "type": "article",
#   "title": "...",
#   "source_domain": "techcrunch.com",
#   "created_at": "2024-08-06T..."
# }]
# embeddings: [vector from Ollama embed model]
```

---

## 5. AI Integration Spec (Ollama-Powered)

### 5.1 Embedding Pipeline
```python
# Endpoint: POST /api/embed
# Model: nomic-embed-text (768d) or mxbai-embed-large (1024d)
# Chunk size: 512 tokens, overlap 50
# All text content chunked and embedded on ingestion
```

### 5.2 RAG Chat Pipeline (AskMemo)
```
1. User sends query + (optional) scope: global | collection | memo
2. Generate query embedding via Ollama embed model
3. ChromaDB query:
   - n_results: 8 (top-k)
   - where filter: workspace_id = current, collection_id if scoped
4. Retrieve full chunk texts + metadata
5. Build system prompt:
   "You are MemoAI. Answer using ONLY the provided context.
    Cite sources using [1], [2] format.
    If insufficient context, say so."
6. Send to Ollama chat model (user-selected):
   POST /api/chat
   {model: "llama3.3", messages: [...], stream: true}
7. Stream response to frontend
8. Parse citations, render as clickable source chips
```

### 5.3 Summary Pipeline
```
Input: Full memo text (or chunks concatenated)
Prompt: "Extract 3-5 key insights from this content. 
         Return as bullet points. Be concise."
Model: Lightweight Ollama model (qwen2.5:7b or mistral:7b)
Output: Stored in memos.ai_summary
```

### 5.4 MemoCast Script Pipeline
```
Input: Array of memo texts from last 24h (or selected)
Prompt: "Write a 3-minute podcast script (≈450 words) reviewing 
         these saved items. Host tone: curious, friendly. 
         Introduce each topic naturally. End with a reflection question."
Model: Larger model (llama3.3:70b or qwen2.5:32b if available)
Output: script_text → TTS → audio file
```

### 5.5 Vision Pipeline
```
Input: Image file
Model: llava / bakllava / gemma3 (via Ollama)
Prompt: "Describe this image in detail. Extract any text visible."
Output: caption + OCR text → embed both
```

### 5.6 Recommended Ollama Models by Task
| Task | Recommended Model | Size |
|---|---|---|
| Fast Chat / Summary | `qwen2.5:7b` or `mistral:7b` | ~4-5 GB |
| Deep Reasoning | `llama3.3:70b` or `qwen2.5:32b` | ~40-45 GB |
| Vision | `llava:13b` or `gemma3:12b` | ~8-9 GB |
| Embeddings | `nomic-embed-text` | ~500 MB |
| Coding/Tool Use | `qwen2.5-coder:14b` | ~9 GB |
| Transcription | `whisper` (via Ollama or faster-whisper) | ~1.5 GB |

---

## 6. Component Breakdown (Implementation Order)

### Phase 1: Foundation (Week 1–2)
1. **Project Scaffold:** FastAPI backend + React frontend monorepo.
2. **Database Setup:** SQLite schema + ChromaDB local init.
3. **Ollama Bridge:** Service class for `/api/embed` and `/api/chat`.
4. **File Ingestion:** Upload endpoint → save to disk → queue for processing.
5. **Basic Card UI:** Grid view with type badges and date grouping.

### Phase 2: Core RAG (Week 3–4)
1. **Chunker Service:** Smart chunking with overlap.
2. **Embedding Pipeline:** Async background job to embed new memos.
3. **AskMemo UI:** Chat panel with streaming, citation parsing.
4. **Search Bar:** Hybrid full-text (SQLite FTS5) + semantic (ChromaDB).
5. **Memo Detail View:** Split pane with content renderer.

### Phase 3: Rich Content (Week 5–6)
1. **Article Reader:** HTML→Markdown→Sanitized render (using `react-markdown`).
2. **PDF Viewer:** `react-pdf` or native iframe + extracted text sidecar.
3. **YouTube Embed:** `react-youtube` + transcript display.
4. **Image Viewer:** Lightbox + AI caption display.
5. **Voice Recorder:** Web Audio API → WAV → Whisper transcription.

### Phase 4: Organization (Week 7)
1. **Collections:** CRUD + drag-to-reorder + pin to sidebar.
2. **Tags:** Auto-extract (LLM) + manual + filter.
3. **Bulk Actions:** Multi-select in list view.
4. **View Toggles:** Grid / List / Timeline.

### Phase 5: AI Polish (Week 8)
1. **AI Summary:** One-click generate + amber-bordered display box.
2. **MemoCast:** Script generation + TTS integration + player UI.
3. **Per-Collection Chat:** Scope filter in RAG query.
4. **Model Switcher:** Dropdown to select active Ollama model per session.
5. **"@" Fallback:** Detect `@general` to bypass RAG and query LLM directly.

### Phase 6: Extension & Export (Week 9)
1. **Chrome Extension:** Manifest V3, content script extraction, side panel.
2. **Export:** Markdown bulk export, PDF generation (via `markdown-pdf` or browser print).
3. **TeamSpace:** Multi-workspace schema + sharing UI.

---

## 7. Chrome Extension Specification

**Manifest V3 Structure:**
```
chrome-extension/
├── manifest.json
├── background.js       (service worker: context menus, API calls)
├── content.js          (page scraping logic per domain)
├── sidepanel.html      (AI summary side panel)
├── popup.html          (Quick save popup)
└── icons/
```

**Content Script Extractors:**
| Site | Extraction Strategy |
|---|---|
| Generic | Readability.js → title + body text + meta description |
| YouTube | `yt-dlp` equivalent via page metadata + transcript API |
| X/Twitter | Extract tweet text from `article[data-testid="tweet"]` |
| Reddit | Post title + selftext or comment thread |
| Gmail | DOM scraping of email body + subject |
| ChatGPT | Extract conversation turns from message divs |

**API Endpoint:** `POST http://localhost:8000/api/extension/save` with payload:
```json
{
  "type": "article",
  "url": "...",
  "title": "...",
  "content_text": "...",
  "html": "...",
  "favicon": "...",
  "collection_id": "uuid",
  "workspace_id": "uuid"
}
```

---

## 8. Key UX Interactions to Nail (Differentiators)

1. **Instant Save Feedback:** When extension saves, show a toast "Saved to MyMemo → [View]".
2. **Streaming Citations:** As AI streams response, parse `[1]` in real-time and render as chips that, on hover, show the memo title + thumbnail.
3. **Related Memo Carousel:** At bottom of detail view, fetch 4 nearest vectors (excluding self) and show horizontal scrollable cards.
4. **Drag-and-Drop Everywhere:** Dashboard accepts file drops. Collections accept memo drops.
5. **Keyboard Shortcuts:** `Cmd+K` global search, `Cmd+Shift+S` save current page (extension), `Esc` close modals.
6. **Empty States:** Beautiful illustrations when no memos exist, with "Try saving your first article" CTA.
7. **Onboarding:** 3-step wizard: (1) Install extension, (2) Save first link, (3) Ask first question.

---

## 9. Local Deployment Model

```yaml
# docker-compose.yml (optional wrapper)
services:
  openmemo-api:
    build: ./backend
    ports: ["8000:8000"]
    volumes:
      - ./data:/app/data
      - ./files:/app/files
    environment:
      - OLLAMA_HOST=http://host.docker.internal:11434

  openmemo-web:
    build: ./frontend
    ports: ["3000:3000"]

  chromadb:
    image: chromadb/chroma
    ports: ["8001:8000"]
    volumes:
      - ./chroma:/chroma/chroma
```

**Prerequisites:**
- Ollama installed locally with pulled models:
  ```bash
  ollama pull nomic-embed-text
  ollama pull qwen2.5:7b
  ollama pull llava:13b
  ollama pull llama3.3:70b  # optional, for heavy reasoning
  ```

---

## 10. File Structure
```
openmemo/
├── backend/
│   ├── main.py
│   ├── api/
│   │   ├── memos.py
│   │   ├── chat.py
│   │   ├── collections.py
│   │   ├── ingest.py
│   │   └── export.py
│   ├── core/
│   │   ├── embedder.py      # Ollama embed calls
│   │   ├── rag.py           # Retrieval + prompt builder
│   │   ├── chunker.py       # Text chunking
│   │   ├── extractor.py     # URL/PDF/Doc extractors
│   │   └── tts.py           # MemoCast audio generation
│   ├── db/
│   │   ├── models.py
│   │   └── chroma_client.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── MemoCard.tsx
│   │   │   ├── MemoGrid.tsx
│   │   │   ├── AskMemo.tsx
│   │   │   ├── MemoDetail.tsx
│   │   │   ├── MemoCastPlayer.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── stores/
│   └── package.json
├── chrome-extension/
└── docker-compose.yml
```

---

This spec gives is a start of a blueprint. The architecture is deliberately local-first: **SQLite + ChromaDB + Ollama** means zero cloud dependencies, zero API keys, and full data ownership. 
The UI is specified to mirror card-driven, chronologically-grouped aesthetic with the split-pane AskMemo interface as the flagship interaction.