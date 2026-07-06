# openMemo

### Organize Your Digital Attic.

One place for everything worth saving. On your machine. Free.

A personal space for saving links, files, notes, and videos. No cloud, no subscriptions, no API keys.

[![Version](https://img.shields.io/badge/version-2.2.0-202020?style=flat-square&logo=github)](https://github.com/izored/OpenMemo/blob/main/docs/CHANGELOG.md) [![License](https://img.shields.io/badge/license-AGPL%203.0-ea2804?style=flat-square)](https://github.com/izored/OpenMemo/blob/main/LICENSE) [![Docker](https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker)](https://github.com/izored/OpenMemo/blob/main/docs/INSTALL.md)

---

## Stop Drowning in Digital Chaos

Articles in bookmarks you'll never re-read. Notes scattered across 4 apps. PDFs buried in Downloads. YouTube videos you meant to summarise. Screenshots you can't find.

**openMemo brings it all together.** One place to capture, organise, and actually use everything you save.

### Capture Anything

|  |  |  |
| --- | --- | --- |
| 📄 **Articles** | 🎬 **Videos** | 📝 **Notes** |
| 🔗 **Links** | 📸 **Images** | 📁 **Files** |
| 🎙️ **Audio** | 📊 **Reports** | 🖼️ **Screenshots** |

Drop a PDF. Paste a URL. Jot a quick note. Record a voice memo. The Chrome Extension captures any webpage in one click.

---

## What's Inside

### 🎙️ Audio Memos
Record a voice memo straight from your mic, or drop in any audio file (lossless WAV and FLAC included). Play it from a now-playing player in the sidebar that follows you across the app. Every recording and upload transcribes on your own machine with faster-whisper, in dozens of languages, on your GPU or CPU. The transcript becomes searchable text, so you can find and ask about what you said.

### 📝 Video Transcripts & Summaries
Get the transcript of any video without losing the video. One click pulls the source's own captions (YouTube, Vimeo, and any host yt-dlp supports), instant and no download, and falls back to local Whisper speech-to-text when a host has none. The video keeps playing inline while the timestamped transcript fills its tab, fully searchable and ask-able. Then summarise it three ways: a **Timestamp** outline of the talk, **Key Insights** bullets, or a flowing **Essay**, each generated on demand by your local Ollama model.

### 💾 Make It Local
Point it at any video or audio link (YouTube, Vimeo, podcast hosts, direct media files, anything yt-dlp can fetch) and openMemo pulls the media down and keeps it. A Memo survives the original being taken offline. Or convert a long video into an audio-only copy when you just want the podcast.

### 📚 Smart Collections
Organise Memos into themed collections with emoji icons and descriptions. Drag and drop cards directly into collections. Scope your AI chat to a single project or topic.

### 🔌 Chrome Extension
One-click save from any webpage. Site-specific extractors pull clean article text, video metadata, and source attribution automatically.

### 🔍 Hybrid Search
**Semantic + Full-Text.** ChromaDB finds things by *meaning*. SQLite FTS5 finds things by *exact words*. Combined, they surface what you need even when you can't describe it perfectly.

### ⚙️ Everything Gets Indexed
Every saved item is automatically processed in the background:
- **Extracted:** PDFs, DOCX, images, audio, and webpages parsed into clean text
- **Embedded:** Vectorised by `nomic-embed-text` for semantic search
- **Indexed:** Added to FTS5 for instant keyword retrieval

### ⚡ AI Chat *(work in progress)*
Ask questions in plain language. Get answers grounded in your actual saved content, with citations back to the source. Real-time streaming via Server-Sent Events. Prefix with `@` to skip your Memos and ask the model directly.

---

---

## Why openMemo?

| Cloud Tools | **openMemo** |
| --- | --- |
| Your data lives on *their* servers | ✅ Your data lives on *your* machine |
| Monthly subscription fees | ✅ Free forever. Open source. |
| Vendor lock-in, proprietary formats | ✅ SQLite + markdown. Export anytime. |
| Closed-source black box AI | ✅ You choose the model. Ollama runs locally. |
| Upload limits, usage caps | ✅ No limits. Your hardware is the ceiling. |
| Privacy policy changes | ✅ No policy. No tracking. No telemetry. |

---

## Quick Start

### The One-Liner (Docker)

```bash
git clone https://github.com/izored/OpenMemo.git
cd OpenMemo
docker-compose up -d
```

Open **http://localhost:8091**. That's it.

### macOS App (Apple Silicon)

OpenMemo also runs as a native Mac app — its own window, Dock icon, ⌘N, PIN
lock, no Docker and no browser. Everything Mac-specific lives under
[`macOS/`](macOS/); build and install guide in [`docs/MACOS.md`](docs/MACOS.md).

### Prerequisites

1. **Ollama** installed and running ([ollama.ai](https://ollama.ai))
2. Pull the recommended models:

```bash
ollama pull nomic-embed-text   # embeddings
ollama pull qwen2.5:7b          # chat (fast, capable)
ollama pull gemma3:4b           # vision / image understanding
```

### Development Mode

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**. See [`docs/INSTALL.md`](docs/INSTALL.md) for the full guide, troubleshooting matrix, and Ollama setup for every platform.

---

## Architecture

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19 + Vite + TypeScript (strict mode), custom token CSS system |
| **State** | Zustand + TanStack Query |
| **Backend** | FastAPI (async Python 3.12) |
| **Vector DB** | ChromaDB (local persistence) |
| **Embeddings** | Ollama `nomic-embed-text` (async background queue) |
| **LLM** | Ollama (any model you choose) |
| **Search** | Hybrid: ChromaDB semantic + SQLite FTS5, re-ranked |
| **Chat** | Server-Sent Events (SSE) streaming |
| **Database** | SQLite (metadata) |
| **Proxy** | nginx (Docker production, single port 80) |

---

## Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. Click the openMemo icon to save any page

---

## Project Structure

```
openmemo/
├── backend/              # FastAPI Python backend
│   ├── api/              # REST routes (memos, chat, ingest, search)
│   ├── core/             # RAG, embeddings, extractors, transcription, localize
│   └── db/               # SQLAlchemy models, SQLite, FTS5
├── frontend/             # React 19 + TypeScript + token CSS system
│   └── src/
│       ├── components/   # UI components
│       ├── pages/        # Route pages
│       ├── stores/       # Zustand state
│       └── lib/          # API client, utilities
├── chrome-extension/     # Manifest V3 browser extension
├── docs/
│   ├── INSTALL.md                  # Full installation & troubleshooting
│   ├── DESIGN.md                   # Design system tokens
│   ├── memo-card-visual-system.md  # Card UI design reference
│   ├── settings-and-appearance.md  # Settings bento + live appearance panel
│   └── CHANGELOG.md                # Release history
└── docker-compose.yml
```

---

## Roadmap

**v2.0** *(current)*: Audio Memos (record, play, local transcription), Make it local (download any video or audio link so it survives the source going offline), persistent audio player, live waveform, redesigned minimal card mode, cinematic light/dark transition, pinning, video thumbnails, drag-to-file collections
**Next**: Transcript-synced playback, AI-suggested collections, similar Memos, multiple views (grid/list/board)
**Later**: Multi-user workspaces, Notion/Obsidian import, mobile responsive, PWA offline support, plugin system

See [`Specs/ROADMAP.md`](Specs/ROADMAP.md) for the full roadmap, architectural findings, and contributor guide.

---

## Built With AI

openMemo was my first serious attempt at building something useful for myself with AI.

It started with **Kimi 2.6 Pro**, then **Claude Code (Opus 4.7 / Sonnet 4.6)**, and later **Perplexity** for quick fixes and release help.

Most of the code is AI-assisted, but not directionless. I knew what I wanted to build from the start, and used AI as a tool to steer execution, iterate faster, and explore solutions.

This project is also a learning record: a messy, practical discovery step into AI-powered software building.

---

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, coding style, and PR guidelines.

- 🐛 [Report a bug](https://github.com/izored/OpenMemo/issues/new?template=bug_report.md)
- 💡 [Request a feature](https://github.com/izored/OpenMemo/issues/new?template=feature_request.md)

---

## Credits & Open Source

openMemo stands on the shoulders of incredible open-source projects: MDXEditor, Ollama, ChromaDB, faster-whisper, yt-dlp, TanStack Query, Zustand, Lucide, dnd-kit, FastAPI, React, Vite, Tailwind CSS.

---

## Licence

AGPL 3.0. Free to use, modify, and self-host. Any derivative work or service must remain open source and share improvements back to the community.
