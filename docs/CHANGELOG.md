# Changelog

All notable changes to OpenMemo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.7.1] - 2026-05-06

### Fixed

- **Blank page / `Prism is not defined` fatal error** — Vite 8's Rolldown bundler wrapped `prismjs` (transitive dep via `@mdxeditor/editor` → `@lexical/code`) in an IIFE, scoping `var Prism` locally. `@lexical/code` referenced bare `Prism` as a free variable, causing a `ReferenceError` that killed the entire JS bundle before React could mount. Downgraded `vite` to 7.3.2 and `@vitejs/plugin-react` to 4.7.0 to restore Rollup-based bundling
- **Ollama `/api/embed` 404 on older versions** — Added automatic fallback from modern `/api/embed` to legacy `/api/embeddings` endpoint in `ollama_client.py`. `embed()` and `embed_batch()` both retry with the legacy endpoint on 404
- **Memo sort 422 error** — `PUT /api/memos/{id}/sort` expected `sort_order` as a query parameter, but the frontend sent it in the JSON body. Changed the endpoint to accept a `SortUpdate` Pydantic model from the request body
- **Removed all blur effects** — Removed `backdrop-blur-sm` from `MemoCard.tsx` drag handle per user preference (no blur anywhere)

### Changed

- `vite` 8.0.10 → 7.3.2 (bundler regression fix)
- `@vitejs/plugin-react` 6.0.1 → 4.7.0 (Vite 7 compatibility)

---

## [1.7.0] - 2026-05-05

### Open-Source Readiness

- **GitHub community files** — Added `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/FUNDING.yml`, and `.github/labels.yml`
- **Community standards** — New `CONTRIBUTING.md` (setup, style, PR workflow), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (reporting + scope), and `SUPPORT.md` (help channels + FAQ)
- **CI skeleton** — Backend test infrastructure (`pytest`, `pytest-asyncio`, `httpx`) in `backend/tests/`. Frontend test deps (`vitest`, `@testing-library/react`) added to `package.json`
- **Documentation** — New `docs/architecture.md`, `docs/deployment.md`, and `docs/faq.md`
- **EditorConfig** — Added `.editorconfig` for consistent cross-editor formatting

### Added

- **Inline memo editing** — MemoDetail page now supports inline editing for title, source URL, tags, collections, content, and notes. Toggle edit mode with the pencil icon
- **User notes / annotations** — Every memo has a private `notes` field (textarea, auto-saved) that is included in embeddings for RAG retrieval
- **Sortable drag & drop** — Memo cards can be reordered within the grid via `@dnd-kit/sortable`. New `PUT /api/memos/{id}/sort` endpoint with `sort_order` persistence
- **Rich link preview** — Article/link memos display favicon, domain, description, thumbnail, and collapsible extracted content in MemoDetail
- **Delete button on MemoCards** — Red `×` appears on hover after a 3-second delay to prevent accidental deletion
- **Dynamic version** — Settings page now shows live version from `/api/health` instead of hardcoded string
- **Rotating greeting** — Dashboard greeting cycles through 10 variations on each page refresh (was once-per-day)

### UX Polish

- **Dark mode foundation** — CSS variable system (`--color-bg-*`, `--color-text-*`) with `html.dark` overrides. Applied across Dashboard, Sidebar, Settings, Search, and Layout
- **Flash-of-light-mode fix** — Inline script in `index.html` applies `dark` class before React hydrates, eliminating FOUC
- **Prominent drag handles** — Grip icon now has dark `bg-[#202020]/80` with `backdrop-blur-sm` for visibility on any card background
- **Ctrl+K search positioning** — Fixed absolute positioning so it no longer overlaps the grid on short viewports
- **Back button styling** — MemoDetail back arrow matches brand color and has hover state

### Infrastructure

- **Environment-driven config** — Removed all hardcoded personal paths/domains. `docker-compose.yml` is clean; local overrides go in `docker-compose.override.yml` (gitignored)
- **Chrome extension config** — API URL is now configurable via an options page (`options.html`) reading from `chrome.storage.sync`. Default: `http://localhost/api`
- **CORS override** — `CORS_ORIGINS` accepts comma-separated env var override for custom domains
- **Demo data seeding** — `seed_data.py` generates 19 rich memos across 4 collections for fresh installs

### Fixed

- **`update_memo()` MissingGreenlet crash** — Replaced async `.clear()` with synchronous `= []` on pre-loaded relationships via `selectinload`
- **`update_memo()` collections/tags persistence** — Collections and tags are now properly replaced on update (not just appended)
- **Hamburger visibility** — Toggle button now visible on all pages including Settings and MemoDetail

---

## [1.6.6] - 2026-05-05

### Security

- **Path traversal fix** — `workspace_id` in file uploads is now sanitized (whitelist `a-zA-Z0-9_-`) preventing `../../` attacks
- **File upload validation** — Max 50MB limit, magic-byte content validation, rejected executable types
- **Secure file serving** — `/files/` static mount replaced with `/api/files/:path` endpoint that verifies memo ownership before serving
- **FTS5 query escaping** — User search terms are escaped before passing to SQLite FTS5 `MATCH`, preventing syntax errors and injection

### Fixed

- **Card detail navigation** — ALL card types now navigate to `/memo/:id` detail view with an "Open Original" button for external links (previously video/link/article cards bypassed detail)
- **`@general` RAG bypass** — Fixed `lstrip("@general")` bug that was stripping individual characters instead of the substring
- **Memo update collections/tags** — `update_memo()` now properly persists `collection_ids` and `tags` changes
- **YouTube subtitle extraction** — Transcript result is now used as `content_text` instead of being discarded
- **Search silent failures** — Exceptions in hybrid search are now logged instead of silently swallowed
- **Chat history over-fetch** — Replaced `.all()[-6:]` with `.order_by(...).limit(6)` SQL-level pagination
- **Async blocking I/O** — ChromaDB operations, PDF parsing, DOCX parsing, image reading, and yt-dlp subprocess now run in threadpool/async subprocess
- **Chrome extension error handling** — Added `response.ok` check before streaming

### Changed

- **Inline search bar** — Replaced centered `SearchModal` popup with a real search input in the Dashboard header. Type directly, see dropdown results, `Ctrl+K` to focus, `Escape` to clear
- **MemoCast audio playback** — Play/pause now wires to a real `<audio>` element with progress tracking and time display
- **Branded local URL** — Default access URL changed from `localhost` to `openmemo.local`. Documented hosts-file setup
- **Removed dead UI** — Hidden Voice tab, Share/Tag/More buttons in MemoDetail until implemented

---

## [1.6.5] - 2026-05-05

### Sidebar & Navigation

- **Push sidebar layout** — Sidebar is now a true flex push layout (`width: 0 ↔ 240px`) instead of an absolute overlay. Main content shrinks naturally when sidebar opens. Removed `backdrop-blur-sm` overlay entirely.
- **Global hamburger menu** — Moved the sidebar toggle from Dashboard to `Layout.tsx` so it's accessible on **all pages** (Dashboard, AskMemo, MemoCast, MemoDetail, Settings).

### Collections Enhancement

- **Collection emoji & description** — Collections now support an emoji icon (default 📁) and an optional description. Backend schema updated with `emoji` and `description` columns.
- **Collection creation modal** — New modal for creating collections with name, emoji picker, description textarea, and color swatches. Reached via the "+" button in the sidebar Collections section.
- **Collection quick edit** — Hovering a collection in the sidebar reveals a pencil icon. Clicking it opens the same modal pre-filled for updating.
- **Sidebar collection display** — Collections now render as `emoji + title` instead of folder icon + name.

### Memo Cards

- **Note card body preview** — Note cards now show `content_text` (the actual body) as the primary preview, falling back to `description` only when body is empty.
- **Drag & drop into collections** — Memo cards are now draggable (grip handle appears on hover). Drop a card onto any sidebar collection to add it. Droppable targets highlight in red on hover. Powered by `@dnd-kit/core`.

### Tooling & Repo

- **`.claude/` added to `.gitignore`** — Keeps Claude local config (skills, plugins, settings) out of the repository while preserving it locally.

---

## [1.6.0] - 2026-05-05

### Infrastructure & Reliability

- **Multi-host Ollama fallback** — `OLLAMA_HOSTS` env var supports comma-separated fallback endpoints. The backend automatically tries localhost, Docker Desktop bridge (`host.docker.internal`), and GPU nodes (`ollama_gpu0`, `ollama_gpu1`) until one responds. Working host is cached for 30s to avoid repeated health checks.
- **Docker Compose fully completed to spec** — Added the missing `nginx` reverse proxy service on port 80 that the v1.5 spec described but was never implemented. API and web containers now use `expose` instead of `ports` — only nginx is publicly accessible.
- **Healthchecks & startup ordering** — `openmemo-api` has an HTTP healthcheck on `/api/health`. `openmemo-web` waits for `service_healthy` before starting, eliminating race conditions where nginx proxies to a still-booting backend.
- **Linux Docker compatibility** — Added `extra_hosts: ["host.docker.internal:host-gateway"]` for native Linux Docker setups where `host.docker.internal` does not resolve by default.
- **Expanded CORS origins** — Added `http://127.0.0.1:3000`, `http://localhost:80`, and `http://localhost` to prevent CORS rejections when accessing via alternate origins.

### AI & Search

- **Vision model updated** — Default vision model changed from `llava:13b` to `gemma3:4b` (smaller, faster, better availability).
- **FTS5 full-text search implemented** — The spec claimed hybrid search (semantic + FTS5) existed, but the code only used `ilike` substring matching. Now properly implements:
  - SQLite FTS5 virtual table (`memos_fts`) with auto-sync triggers
  - Dedicated `backend/api/search.py` router
  - Graceful fallback to `ilike` if FTS5 is unavailable
  - FTS5 index auto-rebuilds on first run

### Design

- **Replicate-inspired design system** — Complete frontend visual overhaul based on the [Replicate DESIGN.md](https://getdesign.md/replicate/design-md) (clean white canvas, code-forward aesthetic):
  - **Color:** Brand accent shifted from amber `#D97706` to Replicate Red `#ea2804`. Primary text is now `#202020` (near-black) on pure white.
  - **Typography:** Added `Inter` for body text and `JetBrains Mono` for code/technical elements via Google Fonts.
  - **Shapes:** Pill-shaped geometry (`rounded-full`) for badges, tags, buttons, active states, and icons.
  - **Buttons:** Primary CTAs are dark solid (`#202020` bg, white text) with `rounded-full`. Secondary actions use outlined pills.
  - **Code blocks:** Dark `#24292e` background with JetBrains Mono, matching GitHub's code aesthetic.
  - **Links:** Dotted underline decoration (Replicate signature pattern) for external/source links.
  - **Borders:** Subtle `#e5e5e5` borders that darken to `#202020` on hover for interactive cards.
  - **Components updated:** Sidebar, Dashboard, MemoCard, MemoGrid, MemoDetail, AskMemoPage, AskMemoPanel, MemoCastPage, AddMemoModal, SearchModal, Layout.

### Documentation

- **New `docs/INSTALL.md`** — Comprehensive installation and troubleshooting guide covering:
  - Development vs Docker production modes
  - Ollama endpoint configuration matrix (native / Docker Desktop / Linux / GPU nodes)
  - Troubleshooting matrix for 8 common issues
  - Windows-specific notes (PowerShell, WSL2)
- **New `docs/CHANGELOG.md`** — This file. Versioning starts at 1.6.0.
- **Updated `README.md`** — Reflects new Docker architecture, multi-host Ollama, design overhaul, and points to full install guide.

### Tooling

- **Impeccable skill installed** at `.claude/skills/impeccable/SKILL.md` — Design quality commands (`/impeccable audit`, `/impeccable polish`, `/impeccable critique`, etc.) and anti-pattern rules for ongoing UI improvements.
- **Replicate `DESIGN.md`** dropped at project root — Design system document that AI coding agents can read for consistent UI generation.

---

## [1.5.0] - 2026-05-05 (Original Release)

### Added

- Streaming SSE for chat — replaces WebSocket proposal from v1.0 spec
- Background task queue for embeddings — ingestion returns 202 Accepted immediately
- Hybrid search at API level — ChromaDB semantic + SQLite full-text merged & re-ranked
- `@` prefix RAG bypass — general knowledge fallback without vector retrieval
- File-type routing in ingestion pipeline — MIME/extension dispatch to correct extractor
- Docker-compose with nginx reverse proxy (spec only — not fully implemented until 1.6.0)
- TypeScript throughout frontend — strict mode, 0 `tsc` errors

---

## Versioning Notes

- **1.5.0** was the original as-built spec release.
- **1.6.0** is the first properly versioned release after addressing all spec-to-code gaps, infrastructure fixes, and the design overhaul.
- Future releases will follow semver: `MAJOR.MINOR.PATCH`.
