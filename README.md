# openMemo

### Organize Your Digital Attic.

One place for everything worth saving. On your machine. Free.

A personal space for saving links, files, notes, and videos. No cloud, no subscriptions, no API keys.

[![Version](https://img.shields.io/badge/version-3.1.1-202020?style=flat-square&logo=github)](https://github.com/izored/OpenMemo/blob/main/docs/CHANGELOG.md) [![License](https://img.shields.io/badge/license-AGPL%203.0-ea2804?style=flat-square)](https://github.com/izored/OpenMemo/blob/main/LICENSE) [![Docker](https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker)](https://github.com/izored/OpenMemo/blob/main/docs/INSTALL.md)

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

Drop a PDF. Paste a URL. Jot a quick note. Record a voice memo. The Chrome Extension captures any webpage in one click. On your phone, share any post to your private Telegram bot and it lands in openMemo by itself.

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

### 📲 Phone Capture
See a post worth keeping while you're out. Share it to your private Telegram bot and keep scrolling. openMemo polls Telegram from your machine, no VPN, no open ports, and files each link like a paste: photo, caption, thumbnail, AI tags. The bot replies with a receipt and buttons to re-file into any collection, or reply with a collection name and it moves. Your PC asleep? Messages queue on Telegram until it wakes. Instagram photo posts land as real image files, not embeds. Add your cookie file and they arrive full resolution, uncropped.

### 🎵 Music Library
A full music page of its own. Paste a Spotify, Apple Music, or YouTube playlist and get it back as a real playlist: per-track downloads, lossless FLAC where the source allows, a play queue with OS media keys, and a now-playing player that follows you across the app. Voice notes and music live apart, each with their own dashboard filter.

### 🗂️ Spaces
Group whole areas of your life. A Space bundles Memos and collections under one cover, one color, one name. Client work, home projects, research topics. Each Space gets its own page.

### 🔍 Hybrid Search
**Semantic + Full-Text.** ChromaDB finds things by *meaning*. SQLite FTS5 finds things by *exact words*. Combined, they surface what you need even when you can't describe it perfectly.

### ⚙️ Everything Gets Indexed
Every saved item is automatically processed in the background:
- **Extracted:** PDFs, DOCX, images, audio, and webpages parsed into clean text
- **Embedded:** Vectorised by your local Ollama embed model for semantic search
- **Indexed:** Added to FTS5 for instant keyword retrieval

### ✨ Ask Memo
Ask questions in plain language. Get answers grounded in your actual saved content, with citations back to the source Memos. One toggle switches between **Memos** (searches your library, cites what it used) and **Chat** (straight to the model, your data stays out of it). Live status while it thinks, streaming answers, scoped chat per memo or per collection. The whole retrieval flow is documented and locked in [ADR-022](docs/ADR-022-ASK-RAG.md).

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

openMemo also runs as a native Mac app. Its own window, Dock icon, ⌘N, PIN
lock, no Docker and no browser. Everything Mac-specific lives under
[`macOS/`](macOS/); build and install guide in [`docs/MACOS.md`](docs/MACOS.md).

### Prerequisites

1. **Ollama** installed and running ([ollama.ai](https://ollama.ai))
2. Pull the recommended models:

```bash
ollama pull nomic-embed-text-v2-moe   # embeddings
ollama pull gemma4:e4b                 # chat + vision (fast, capable)
```

Any Ollama chat model works. Pick yours in Settings → Local AI, or per conversation from the Ask composer. Full model guide in [`docs/ollama.md`](docs/ollama.md).

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
| **Embeddings** | Ollama (nomic embed models, async background queue) |
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
│   ├── ollama.md                   # Models, retrieval, context windows
│   ├── DECISIONS.md                # Architecture Decision Records
│   ├── ADR-022-ASK-RAG.md          # The locked Ask Memo / RAG flow
│   ├── memo-card-visual-system.md  # Card UI design reference
│   ├── settings-and-appearance.md  # Settings bento + live appearance panel
│   └── CHANGELOG.md                # Release history
└── docker-compose.yml
```

---

## Roadmap

**v3.0** *(current)*: Music library with playlist import and lossless pulls, Spaces, Ask Memo with the Memos/Chat toggle and per-memo citations, native macOS app, mobile responsive pass, editable thumbnails, hidden section behind a passcode, cinematic onboarding
**Next**: Transcript-synced playback, AI-suggested collections, similar Memos, multiple views (grid/list/board)
**Later**: Multi-user workspaces, Notion/Obsidian import, PWA offline support, plugin system

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

AGPL 3.0. Free to use, modify, and self-host. Any derivative work or service must remain open source and share improvements back to the community, and must keep the credit: "Based on openMemo by DIR (dev.izo.red)". Full text in [`LICENSE`](LICENSE), attribution terms in [`NOTICE`](NOTICE), plain-English walkthrough in [`docs/LICENSE-EXPLAINED.md`](docs/LICENSE-EXPLAINED.md).
