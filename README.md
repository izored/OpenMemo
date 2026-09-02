# openMemo

### Organize Your Digital Attic.

One place for everything worth saving. On your machine. Free.

A personal space for saving links, files, notes, and videos. No cloud, no subscriptions, no API keys.

[![Version](https://img.shields.io/badge/version-3.17.0-202020?style=flat-square&logo=github)](https://github.com/izored/OpenMemo/blob/main/docs/CHANGELOG.md) [![License](https://img.shields.io/badge/license-AGPL%203.0-ea2804?style=flat-square)](https://github.com/izored/OpenMemo/blob/main/LICENSE) [![Docker](https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker)](https://github.com/izored/OpenMemo/blob/main/docs/INSTALL.md)

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

Dropping works from either direction. Drag files in from Finder or Explorer, or drag a link, a picture or a highlighted paragraph straight out of a browser window. Land on a collection and it saves there on release; land on the bare dashboard and openMemo asks where it goes first.

---

## What's Inside

### 🎙️ Audio Memos
Record a voice memo straight from your mic, or drop in any audio file (lossless WAV and FLAC included). Play it from a now-playing player in the sidebar that follows you across the app. Every recording and upload transcribes on your own machine with faster-whisper, in dozens of languages, on your GPU or CPU. The transcript becomes searchable text, so you can find and ask about what you said.

### 📝 Video Transcripts & Summaries
Get the transcript of any video without losing the video. One click pulls the source's own captions (YouTube, Vimeo, and any host yt-dlp supports), instant and no download, and falls back to local Whisper speech-to-text when a host has none. The video keeps playing inline while the timestamped transcript fills its tab, fully searchable and ask-able. Then summarise it three ways: a **Timestamp** outline of the talk, **Key Insights** bullets, or a flowing **Essay**, each generated on demand by your local Ollama model.

### 💾 Make It Local
Point it at any video or audio link (YouTube, Vimeo, podcast hosts, direct media files, anything yt-dlp can fetch) and openMemo pulls the media down and keeps it. A Memo survives the original being taken offline. Or convert a long video into an audio-only copy when you just want the podcast.

### 📄 PDFs Open As PDFs
Drop a PDF in and the memo page shows the document, not a transcript of it. Real pages, with the layout, the tables, the figures and the signatures still on them. Page through it, zoom, fit to the width, rotate, go full width, or download the original. Pages draw as you scroll and are released when they leave, so a four hundred page report opens as fast as a one page receipt. The extracted text has not gone anywhere: it is still what search and Ask read, and it is still on the page, folded up underneath.

It is drawn by openMemo rather than handed to the browser's own viewer, so it wears whatever theme you are in, and the paper inside the frame stays white because a document's own ink is not ours to tint. Everything it needs to draw, down to the character maps for non-Latin scripts, is served from your own machine. A PDF renders with the network unplugged.

On the dashboard, a PDF's card is its first page rather than a generic document icon, so a lease does not look like nine invoices.

### 📚 Smart Collections
Organise Memos into themed collections with emoji icons and descriptions. Drag and drop cards directly into collections. Scope your AI chat to a single project or topic. A collection you fill fast, a shopping wishlist or a research dump, can be hidden from the dashboard so it stops burying everything else, while staying in the sidebar and in search.

### 🔌 Chrome Extension
One-click save from any webpage. Site-specific extractors pull clean article text, video metadata, and source attribution automatically.

### 📲 Phone Capture
See a post worth keeping while you're out. Share it to your private Telegram bot and keep scrolling. openMemo polls Telegram from your machine, no VPN, no open ports, and files each link like a paste: photo, caption, thumbnail, AI tags. The bot replies with a receipt and buttons to re-file into any collection, or reply with a collection name and it moves. Your PC asleep? Messages wait on Telegram for 24 hours, and openMemo collects them the moment it wakes. Instagram photo posts land as real image files, not embeds. Add your cookie file and they arrive full resolution, uncropped.

### 🎵 Music Library
A full music page of its own. Paste a Spotify, Apple Music, or YouTube playlist and get it back as a real playlist: per-track downloads, lossless FLAC where the source allows, a play queue with OS media keys, and a now-playing player that follows you across the app. Voice notes and music live apart, each with their own dashboard filter.

### 🕸️ Mesh
Two computers, one library. Your Mac and your PC each hold everything, and both can write. Changes travel in both directions, so it stops mattering which machine you happen to be sat at.

No account. No cloud. Nothing in the middle. You pair them once with a 12 word code, or point a camera at a QR, and they find each other on your network from then on.

It does not shove 25 GB around. Your library's text is a few megabytes, and most of your media can be fetched again from where it came from. So the other machine pulls what you actually open, grabs your 20 most recent Memos up front, and fills in the rest quietly. Your laptop is usable in seconds instead of after a two hour progress bar. Notes, tags, transcripts and AI summaries all arrive as text, so joining a Mesh never re-runs Whisper or Ollama.

Spaces, collections, playlists and covers come across first. A Space showing up without its artwork looks broken. A track still downloading does not.

Nothing gets overwritten behind your back. Edit the same note on both machines and openMemo shows you both versions, says which device each came from, and keeps both by default. Every sync is written down with the reason it decided what it did, and any of them can be undone.

openMemo itself never goes online. Mesh runs on its own separate port that serves exactly one thing, the sync channel, and everything on the wire is encrypted with AES-256 and signed with a key only your two computers hold. Off by default, behind one toggle in Settings. While it is off it costs your install nothing at all.

Two switches, not one. Turning Mesh on lets you pair. A second switch, **Reachable from your other computer**, is what actually opens the port. Off, openMemo listens only to itself. That is deliberate: opening a port is a decision you make, not something an update does to you. Your 12 word code lives in your operating system's own vault, the keychain on a Mac and account level encryption on Windows.

Step by step for two machines, including from different networks: [the pairing walkthrough](docs/MESH-PAIRING-WALKTHROUGH.md). Design in [ADR-024](docs/ADR-024-MESH.md), full write-up in [the handbook](docs/MESH-HANDBOOK.md), and what it does before, during and after you switch it on in [the security audit](docs/MESH-SECURITY.md).

### 🗂️ Spaces
Group whole areas of your life. A Space bundles Memos and collections under one cover, one color, one name. Client work, home projects, research topics. Each Space gets its own page.

### 🛟 Backups You Can Actually Restore
openMemo compresses a copy of your library on its own, daily, and keeps the recent ones. Settings lists them by date and size, and restoring one is picking it from the list. No exporting, no re-uploading a file the app wrote itself. Restoring keeps a copy of what it is about to replace, so changing your mind is a second restore rather than a loss. On the Mac, dropping in a new build saves a copy before the new backend is allowed to touch your library, named for the version jump it is about to make, because a database only migrates forwards. Open a library that a newer version already touched and it says so first, with a copy saved and the option to quit straight back out.

### 📴 Works With The Internet Unplugged
Rendering openMemo makes no network request at all. Fonts are served from your own machine, favicons are cached, and embedded players are built only when you press play instead of the moment a memo appears on screen. When the connection drops, a quiet strip appears at the top and the app keeps working on everything already on disk. It disappears when you are back.

### 🔍 Hybrid Search
**Semantic + Full-Text.** ChromaDB finds things by *meaning*. SQLite FTS5 finds things by *exact words*. Combined, they surface what you need even when you can't describe it perfectly.

### ⚙️ Everything Gets Indexed
Every saved item is automatically processed in the background:
- **Extracted:** PDFs, DOCX, images, audio, and webpages parsed into clean text (a PDF keeps its real pages too, see above)
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
| Sync means uploading to their servers | ✅ Your devices talk to each other. Nothing in between. |

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
# Backend — from the REPO ROOT, not backend/
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8099

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

Two things that catch people out. Run uvicorn from the repo root: `backend` is a package, so importing `backend.main` needs its parent on `sys.path`. And use port **8099**, because that is what the Vite proxy targets by default; a backend on any other port means every API call fails. On Windows, `.\dev.ps1` starts both with the right ports already set.

See [`docs/INSTALL.md`](docs/INSTALL.md) for the full guide, troubleshooting matrix, and Ollama setup for every platform.

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
│   ├── api/              # REST routes (memos, chat, ingest, search, music, spaces, mesh, backup)
│   ├── core/             # RAG, embeddings, extractors, transcription, jobs, media, integrity
│   │   └── mesh/         # Peer sync: pairing, protocol, merge, journal, keystore
│   ├── services/         # Memo service, Telegram relay
│   └── db/               # SQLAlchemy models, SQLite, FTS5, Chroma client
├── frontend/             # React 19 + TypeScript + the om-* token CSS system
│   └── src/
│       ├── components/   # UI components
│       ├── pages/        # Route pages
│       ├── stores/       # Zustand state
│       ├── styles/       # openmemo.css tokens, typeset.css, fonts.css
│       └── lib/          # API client, utilities
├── chrome-extension/     # Manifest V3 browser extension
├── macOS/                # The native Mac app: window, PIN lock, bundled backend
├── scripts/              # Repo tooling, including the pre-commit secret checker
├── Specs/ROADMAP.md      # The roadmap
├── docs/
│   ├── INSTALL.md                  # Full installation & troubleshooting
│   ├── MACOS.md                    # Building, installing and updating the Mac app
│   ├── ollama.md                   # Models, retrieval, context windows
│   ├── DECISIONS.md                # Architecture Decision Records index
│   ├── ADR-022-ASK-RAG.md          # The locked Ask Memo / RAG flow
│   ├── ADR-024-MESH.md             # Mesh design
│   ├── ADR-025-LOCAL-FIRST.md      # What openMemo will not contact, and why
│   ├── MESH-HANDBOOK.md            # Mesh, end to end
│   ├── MESH-PAIRING-WALKTHROUGH.md # Pairing two machines, step by step
│   ├── MESH-SECURITY.md            # What Mesh does before, during and after you switch it on
│   ├── BACKUP-AND-RESTORE.md       # Automatic snapshots, archives, restoring
│   ├── DISASTER-RECOVERY.md        # The first five minutes when data goes missing
│   ├── AUDIO_MEMO_HANDBOOK.md      # Recording, transcription, the sidebar player
│   ├── music-library.md            # Playlists, lossless pulls, the relay
│   ├── make-it-local.md            # Download ladder, and how videos keep their sound
│   ├── carousel-from-links.md      # Bundling pasted image links into one memo
│   ├── cookies-restricted-downloads.md  # Cookie files for logged-in sources
│   ├── memo-card-visual-system.md  # Card UI design reference
│   ├── settings-and-appearance.md  # Settings bento + live appearance panel
│   ├── SECURITY-personal-data.md   # The pre-commit secret guard
│   ├── RELEASING.md                # How a release is cut and verified
│   └── CHANGELOG.md                # Release history
├── DESIGN.md             # The token system, and the rules that break if ignored
└── docker-compose.yml
```

---

## Roadmap

**v3.13** *(current)*: Mesh two-way sync between your machines, backups that restore and that run before a Mac update, full offline operation, a native macOS app with its own settings and PIN lock, music library with playlist import and lossless pulls, Spaces, Ask Memo with the Memos/Chat toggle and per-memo citations, phone capture through a private Telegram bot, mobile responsive pass, hidden section behind a passcode, cinematic onboarding
**Next**: Transcript-synced playback, AI-suggested collections, similar Memos, multiple views (grid/list/board)
**Later**: Multi-user workspaces, Notion/Obsidian import, PWA install, plugin system

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

- 🐛 [Report a bug](https://github.com/izored/OpenMemo/issues/new?template=bug_report.yml)
- 💡 [Request a feature](https://github.com/izored/OpenMemo/issues/new?template=feature_request.yml)

---

## Credits & Open Source

openMemo is mostly other people's work. Every project below is free and open source, written by someone who gave it away, and there is no version of this app that exists without them. The same list is in **Settings**, where hovering a name tells you what it does here.

**The app itself**
[React](https://react.dev) ·
[Vite](https://vitejs.dev) ·
[TypeScript](https://www.typescriptlang.org) ·
[React Router](https://reactrouter.com) ·
[TanStack Query](https://tanstack.com/query) ·
[Zustand](https://github.com/pmndrs/zustand) ·
[Motion](https://motion.dev) ·
[dnd-kit](https://dndkit.com) ·
[Radix UI](https://www.radix-ui.com) ·
[Lucide](https://lucide.dev) ·
[Lenis](https://lenis.darkroom.engineering) ·
[date-fns](https://date-fns.org) ·
[Tailwind CSS](https://tailwindcss.com)

**Reading what you saved**
[MDXEditor](https://mdxeditor.dev) ·
[pdf.js](https://mozilla.github.io/pdf.js/) ·
[PDFium](https://pdfium.googlesource.com/pdfium/) via [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) ·
[CodeMirror](https://codemirror.net) ·
[react-markdown](https://github.com/remarkjs/react-markdown) ·
[pypdf](https://github.com/py-pdf/pypdf) ·
[python-docx](https://github.com/python-openxml/python-docx) ·
[openpyxl](https://foss.heptapod.net/openpyxl/openpyxl) ·
[Pillow](https://python-pillow.org)

**Getting things in**
[yt-dlp](https://github.com/yt-dlp/yt-dlp) ·
[gallery-dl](https://github.com/mikf/gallery-dl) ·
[FFmpeg](https://ffmpeg.org) ·
[Playwright](https://playwright.dev) ·
[Beautiful Soup](https://www.crummy.com/software/BeautifulSoup/) ·
[readability-lxml](https://github.com/buriy/python-readability) ·
[lxml](https://lxml.de) ·
[Mutagen](https://mutagen.readthedocs.io)

**The intelligence, all of it local**
[Ollama](https://ollama.com) ·
[Whisper](https://github.com/openai/whisper) ·
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) ·
[CTranslate2](https://github.com/OpenNMT/CTranslate2) ·
[ChromaDB](https://www.trychroma.com)

**Holding it together**
[FastAPI](https://fastapi.tiangolo.com) ·
[Uvicorn](https://www.uvicorn.org) ·
[SQLAlchemy](https://www.sqlalchemy.org) ·
[SQLite](https://sqlite.org) ·
[Pydantic](https://docs.pydantic.dev) ·
[HTTPX](https://www.python-httpx.org) ·
[APScheduler](https://github.com/agronholm/apscheduler) ·
[cryptography](https://cryptography.io) ·
[Zeroconf](https://github.com/python-zeroconf/python-zeroconf) ·
[qrcode](https://github.com/lincolnloop/python-qrcode) ·
[nginx](https://nginx.org) ·
[Docker](https://www.docker.com)

**Type**
Set in [Satoshi](https://www.fontshare.com/fonts/satoshi) by Indian Type Foundry, free through Fontshare and served from your own machine rather than a CDN.

If your project is here and you would rather it was described differently, or not listed at all, open an issue and it changes.

---

## Licence

AGPL 3.0. Free to use, modify, and self-host. Any derivative work or service must remain open source and share improvements back to the community, and must keep the credit: "Based on openMemo by DIR (dev.izo.red)". Full text in [`LICENSE`](LICENSE), attribution terms in [`NOTICE`](NOTICE), plain-English walkthrough in [`docs/LICENSE-EXPLAINED.md`](docs/LICENSE-EXPLAINED.md).
