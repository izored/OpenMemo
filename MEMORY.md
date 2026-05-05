# OpenMemo — Project Memory

> Living document for contributors and maintainers. Contains the project's purpose, architectural findings, and the public roadmap.

---

## Purpose

**OpenMemo** is a **local-first AI Knowledge OS**.

Save articles, notes, PDFs, images, voice memos, and videos — then query your entire personal knowledge base with AI-powered RAG chat. Everything runs locally: **Ollama** for LLMs, **SQLite** for structured data, **ChromaDB** for vector search. No cloud, no API keys, full data ownership.

### Core Philosophy

- **Local-first** — Your data never leaves your machine
- **Zero-effort capture** — Chrome extension, drag & drop, quick-add modal
- **AI-native retrieval** — Every saved item is embedded and searchable by meaning, not just keywords
- **Clean, focused UI** — Distraction-free canvas for thinking and discovery

---

## Architecture & Findings

### Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.12, FastAPI, SQLAlchemy (async), Pydantic Settings |
| Frontend | React 19, TypeScript (strict), Tailwind CSS v4, Vite |
| State | Zustand (client), TanStack Query (server state) |
| Database | SQLite + aiosqlite |
| Vector DB | ChromaDB (local persistence) |
| AI/LLM | Ollama (multi-host fallback) |
| Search | FTS5 (SQLite) + ChromaDB semantic hybrid |
| TTS | Coqui TTS (MemoCast podcast generation) |
| Deploy | Docker Compose (nginx + API + web + ChromaDB) |

### Key Design Decisions

1. **No auth gate** — Single-user local mode only. A default user and workspace are auto-created on first boot. Multi-user support is a future milestone, not a current priority.

2. **Ollama multi-host fallback** — The backend tries multiple Ollama endpoints (`localhost`, `host.docker.internal`, GPU nodes) and caches the working one. This makes Docker + native Ollama setups painless across Windows, macOS, and Linux.

3. **Hybrid search (FTS5 + semantic)** — FTS5 handles exact keyword matches; ChromaDB handles meaning-based retrieval. Results are merged and re-ranked for chat grounding.

4. **Tailwind v4 `@layer` utilities** — The project uses Tailwind v4's CSS-first configuration. **Never** add unlayered global resets like `* { margin: 0; padding: 0 }` — they override all `@layer` utilities and break the design system.

5. **Push sidebar layout** — The sidebar is a flex push layout (width transition), not an absolute overlay. This avoids z-index wars and backdrop blur performance issues.

6. **Drag & drop with activation constraints** — Memo cards use `@dnd-kit/core` with `distance: 8` activation. This preserves normal click behavior while enabling drag-to-collection.

### Gotchas for Contributors

- **Docker build cache** — Frontend dist assets get hashed filenames. After a deploy, always hard-refresh the browser (`Ctrl+F5`) to avoid stale CSS/JS.
- **Backend schema changes** — SQLite has no built-in migration tool. Adding columns requires `ALTER TABLE` or manual migration scripts. See `backend/migrate_collections.py` as a template.
- **OLLAMA_HOSTS parsing** — The environment variable must be a JSON array string in Docker Compose (`'["http://..."]'`) to satisfy pydantic-settings list parsing.
- **Windows PowerShell** — Use `;` not `&&` as command separators in Shell tool calls.

---

## Roadmap

### v1.7.0 — Collection Polish & Discovery

- [ ] **Collection detail page** (`/collection/:id`) with dedicated grid view
- [ ] **Bulk select & drag** — Select multiple memos, drag as a group into a collection
- [ ] **Collection reordering** — Drag to reorder collections in the sidebar
- [ ] **Full-text search UI** — Wire the existing FTS5 backend into the frontend search modal (currently only does substring matching)
- [ ] **Tag system** — Add/remove tags on memos, tag-based filtering in sidebar
- [ ] **Inline note editing** — Edit title and body directly in MemoDetail without re-ingestion

### v1.8.0 — Capture & Mobile

- [ ] **Chrome extension polish** — Fix site-specific extractors, add quick-save popup with collection picker
- [ ] **Voice memo recording** — Replace the placeholder with real Web Audio API recording + transcription via Ollama
- [ ] **Drag & drop file upload on dashboard** — Drop files directly onto the canvas
- [ ] **Mobile responsive pass** — Sidebar becomes a drawer, grid collapses to 1-2 columns
- [ ] **PWA / offline support** — Service worker, offline reads, sync on reconnect

### v1.9.0 — Intelligence & Automation

- [ ] **AI-powered "similar memos"** — Suggest related content in MemoDetail sidebar
- [ ] **Recent activity feed** — Timeline of saves, edits, and chat sessions
- [ ] **Auto-collections** — AI-suggested collections based on content clustering
- [ ] **Smart summaries** — One-click TL;DR for articles and videos
- [ ] **Dark mode** — Complete theming (toggle exists but doesn't cover all components)

### v2.0.0 — Collaboration (Future)

- [ ] **Multi-user / workspace sharing**
- [ ] **Import/export** — Markdown, Notion, Obsidian vault import
- [ ] **Plugin system** — Custom extractors and chat middleware
- [ ] **Self-hosted cloud deploy** — One-click deploy to VPS / homelab

---

## Contributing

1. **Install** — See [`docs/INSTALL.md`](docs/INSTALL.md)
2. **Bump version** — Run `.\bump-version.ps1 patch|minor|major` (Windows) or adapt for your shell
3. **Test** — `docker-compose build openmemo-web && docker-compose up -d --no-deps openmemo-web`
4. **No personal data in commits** — Hardcoded paths, usernames, and local env values should never reach the repo. `.env` is already gitignored.

---

## License

See [LICENSE](LICENSE) in the repository root.
