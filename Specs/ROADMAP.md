# OpenMemo — Roadmap

Single source of truth for all planned work. Versioned milestones + unversioned backlog.

---

## ✅ Shipped

### v1.7.0 — Open-Source Readiness & UX Polish

- [x] Open-source readiness — community files, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, CI skeleton, docs
- [x] Inline memo editing — title, URL, tags, collections, content, notes in MemoDetail
- [x] User notes / annotations — private `notes` field, auto-saved, included in RAG
- [x] Sortable drag & drop — reorder memo cards via `@dnd-kit/sortable`
- [x] Rich link preview — favicon, domain, description, thumbnail, collapsible content
- [x] Delete button on MemoCards — red `×` on hover with 3-second delay
- [x] Dynamic version — Settings page pulls live version from `/api/health`
- [x] Rotating greeting — 10 variations cycling on every page refresh
- [x] Dark mode foundation — CSS variable system, `html.dark` overrides, FOUC fix
- [x] Environment-driven config — no hardcoded paths, `docker-compose.override.yml`
- [x] Chrome extension config — API URL via options page (`chrome.storage.sync`)
- [x] Demo data seeding — `seed_data.py` generates 19 rich memos across 4 collections

### v1.7.1 — Theming & Standards

- [x] Theming system (dark mode root fix)
- [x] Shared component standards
- [x] Layout & spacing standards
- [x] Animation & transition standards
- [x] Security as a standard

### v1.7.2 — Speed Dial FAB & Polish

- [x] Speed Dial FAB — quick-add actions with animated dial
- [x] Card clip fix at grid bottom
- [x] Optimistic reorder drag & drop fix

### v1.7.3 — Settings Page Redesign & New Cards *(shipped early from v1.8.5 + v1.11.0)*

- [x] **[J] Stats card** — full-width bento card with live memo/collection/tag counts from `/api/stats`; by-type emoji pills; "this week" counter
- [x] **[G] Feedback card** — "Send Feedback" mailto card (`dev@izo.red`) with pre-filled subject
- [x] Chrome Extension card — "Save from anywhere" with View on GitHub link
- [x] Keyboard Shortcuts card — always-visible 3-col grid of 6 shortcuts
- [x] Danger Zone card — Export all memos button + disabled Clear all with warning copy
- [x] **[I] Creator card** — "Made By Reda Izo" with portrait photo, bio, 4 social link pills (izo.red, GitHub, X, Threads)
- [x] Built With ❤️ card — mosaic grid of 11 open-source dependencies with one-line descriptions
- [x] Version footer — replaces About card; O logo + `v{version}` from `/api/health`
- [x] Full 2-column bento grid layout for Settings page
- [x] `/api/stats` backend endpoint — counts by type, weekly activity

---

## v1.7.4 — UX Quick Wins + P1 Fixes *(NEXT — IN PROGRESS)*

**P1 fixes (this session):**
- [x] **[L] Note markdown render in MemoDetail** — `MarkdownEditor` now derives `editing` from `viewFirst` prop instead of fragile `useState(!viewFirst)` + sync effect. ReactMarkdown renders on load; MDXEditor opens only on user click. *(Regression fixed)*
- [x] **[L2] Markdown paste + render full fix** — Plain-text paste now routes through `insertMarkdown()` so syntax (`#`, `**`, fenced code, tables) becomes proper nodes instead of escaped literals. Added `codeMirrorPlugin` so fenced code blocks (Python/Bash/JSON/etc.) actually paste and render. Added `@tailwindcss/typography` plugin so `prose` classes style headings/lists/blockquotes. Updated `code` component for react-markdown v10 (`inline` prop removed) across 4 files. Tightened note view spacing (`prose-sm` + custom margins).
- [ ] **[A] Note card content preview** — `MemoCard` for `type === 'note'` shows only title; render 3–4 line snippet from `content_text` / `content_raw`. *(Visible regression)*

**UX quick wins:**
- [x] **Filters on search bar line** — Type filters (All / Image / Links / Videos / Notes / Files) moved to same line as search box, compact pill style
- [x] **FAB-dial** ease-in animation on hover; main FAB click opens note directly
- [x] **Greeting left-align** — Left-justified greeting on same header row as filters + search

---

## v1.7.4 — RAG + Broken Core Fixes *(P2)*

- [ ] **[P] RAG full audit** — Verify ChromaDB receives embeddings on save, hybrid search (FTS5 + Chroma) returns results, retrieved context injects correctly. Add `GET /api/debug/rag?q=...` endpoint returning retrieved chunks
- [ ] **[Q] System prompt injection** — Inject OpenMemo assistant system prompt as first `role: "system"` message on Ollama chat payload, never visible to user
- [ ] **[R] Seamless RAG default** — Drop `@general` requirement; every chat message auto-queries knowledge base. Keep `@collection-name` syntax for scoped queries
- [x] **[D] Image thumbnail on ingest** — Effectively fixed in 1.8.6: `/api/memos/{id}/file` serves originals inline, cards/MemoDetail point at it; cross-env `file_path` resolved via `backend/core/file_paths.resolve_memo_path()` (PR #17 + #18).
- [x] **[E] Image preview on MemoDetail** — Fixed in 1.8.6 via the same tolerant resolver + new `MediaPreview` component with lightbox / fullscreen / theater (PR #18).
- [ ] **[F] Speed Dial main `+` button** — Tapping the `+` (without hovering child) opens default Add Memo modal (Link tab)

---
## v1.7.42 — UX Quick Wins + P1 Fixes *(completed)*

- [x] Note markdown render in MemoDetail
- [x] Markdown paste + render full fix
- [x] Note card content preview
- [x] Filters on search bar line
- [x] FAB-dial animation and click behavior
- [x] Greeting left-align
- [x] **[DG] Settings dashboard grid control** — added user-facing 4/5 memo-card selector in Settings Appearance; MemoGrid reads saved preference instead of hardcoded desktop columns
---

## v1.8.0 — Collections, Notes, Detail Polish *(P3 + P4)*

**Collections & notes (existing):**
- [ ] **Collection management page** — `/collections`: grid view, drag-to-reorder, inline edit thumbnail + name
- [ ] **Collection detail page** — `/collection/:id` with dedicated memo grid
- [ ] **Full-page note editor** — "Add Memo" note tab: simple textarea → "Expand" → full-page MDXEditor (Gmail-style)
- [ ] **Bulk select & drag** — Multi-select memos, drag as group into collection
- [ ] **Collection reordering** — Drag-to-reorder collections in sidebar
- [ ] **Full-text search UI** — Wire FTS5 backend into frontend search modal
- [ ] **Tag system v2** — Sidebar tag filtering, tag cloud, quick-add from dashboard

**Detail page redesign (P4):**
- [ ] **[N] Detail header redesign** — Pill back button (`← Memos`), large editable title, single-line metadata row, ghost pill action buttons right-aligned
- [ ] **[O] AI summary UX rethink** — Collapsed `✨ Summary` chip if `ai_summary` exists, inline loading state, distinct soft card (`--color-surface-offset` bg)
- [ ] **[B] AI summary on note cards** — Render `ai_summary` (2 sentences) instead of raw snippet when present; sparkle icon in card hover menu triggers `/api/memos/{id}/summarize`

**Collections polish (P4):**
- [ ] **[K] Stacked cards hover** — 3 ghost cards fan out behind collection card on hover (pure CSS `transform`)

---

## v1.8.5 — Major Features *(P3)*

- [ ] **[C] Bento grid + card size library** — `CardSize` type (`1x1`/`2x1`/`1x2`/`2x2`/`3x1`/`1x3`), `card_size` DB column migration, content-aware defaults per memo type, hover resize handle popover, MemoCard layout adapts to size, DnD preserved. Full spec in [Bento Grid spec section](#bento-grid-spec)
- [ ] **[M] Sub-memo system** — `sub_memos` table (`parent_memo_id`, `type`, `content`, `created_at`), endpoints `POST/GET /api/memos/{id}/sub-memos`, `DELETE /api/sub-memos/{id}`, max 30 enforced both sides. iMessage-style input bar at bottom of MemoDetail, vertical card list. Replaces "My Notes" textarea
- [ ] **[V] Tagging system** — `/tags` page with tag list + memo counts, click-to-filter, autocomplete in edit mode, sidebar tag cloud (top 10)
- [x] **[J] Stats dashboard** — `GET /api/stats` returning total memos (by type), total collections, storage bytes, top tags, memos this week. Settings grid of stat cards *(shipped in v1.7.3)*

---

## v1.9.0 — Dashboard, Capture, AskMemo Polish

**Dashboard & capture (existing):**
- [ ] **Widget system** — Sticky widgets on dashboard canvas: clock, weather, quick-note, stock ticker, app shortcuts, news feed; per-user customizable layout
- [ ] **Dashboard edit mode** — "Customize" button enters edit mode: cards movable, widget slots revealed
- [ ] **Chrome extension polish** — Site-specific extractors, quick-save popup with collection picker
- [ ] **Voice memo recording** — Web Audio API → `POST /api/ingest/voice` → Whisper → `type: audio` memo
- [ ] **Drag & drop file upload on dashboard**
- [ ] **Mobile responsive pass** — Sidebar drawer, 1–2 col grid
- [ ] **PWA / offline support**

**AskMemo polish (P4):**
- [ ] **[U] Chat history panel** — Two-column side panel as chat history (history left, active chat right). Each entry: truncated first user message + timestamp
- [ ] **[T] Info dropdown on model selector** — ℹ️ icon left of selector → dropdown panel with AskMemo description, best practices, example queries
- [ ] **[S] Disclaimer banner** — Small `--color-text-muted` centered banner under chat header: "Chat history is not saved — this session will be cleared on refresh. AskMemo is a work in progress." Dismissible × per session

**Pinned memos (P4):**
- [~] **[W] Pinned memos sidebar** — *Partially shipped in 1.8.6 (PR #18):* `memos.pinned BOOLEAN DEFAULT 0` migration, `PUT /api/memos/{id}/pin`, `GET /api/memos/pinned/list`, sidebar Pinned section now renders pinned memos alongside pinned collections, MemoDetail has Pin/Unpin pill. Still TODO: pin from card hover menu (currently only MemoDetail), pinned-first ordering in the main grid, drag-to-reorder UI inside the Pinned section (sort_order is wired, UI not).

---

## v1.10.0 — Intelligence & Automation

- [ ] **AI "similar memos"** — Related content suggestions in MemoDetail sidebar
- [ ] **Recent activity feed** — Timeline of saves, edits, chat sessions
- [ ] **Auto-collections** — AI-suggested collections via content clustering
- [ ] **Smart summaries** — One-click TL;DR for articles + videos
- [ ] **Dark mode completion** — Full component coverage (hardcoded colors remain)

---

## v1.10.5 — Background Maintenance & DB Health

Silent scheduled jobs that keep a user's database tidy, searchable, and lean —
no user action required. All run on the existing APScheduler instance wired in
`backend/main.py` lifespan (startup + cron), each idempotent and best-effort
(never crash the app), each with a manual `POST /api/maintenance/*` trigger +
`?dry_run=true` preview. Pattern established by the memo-type sorter below.

**Shipped (foundation):**
- [x] **Memo-type sorter** — `backend/core/classify.py` (`derive_memo_type` + `reclassify_all`). Re-files every memo to its canonical type (file→extension, youtube/social→video, direct media link→image/document, web page→link, text→note). Runs on startup + Mon & Thu 03:00. `POST /api/maintenance/reclassify-types`. *(shipped 1.8.6)*
- [x] **Video thumbnail backfill** — `POST /api/maintenance/backfill-video-thumbs` regenerates thumbs for videos missing them (ffmpeg now baked into the API image). *(shipped 1.8.6)*

**Top priority (silent breakage — highest user value):**
- [ ] **Re-embed backfill** — find memos with no `embedding_ids` (Ollama down at ingest, or failed) and re-embed them. Without this they never surface in RAG/chat. Schedule + `POST /api/maintenance/reembed-missing`.
- [ ] **Chroma↔SQLite consistency** — prune vector chunks whose memo was deleted; re-add chunks missing from Chroma. Stops phantom and missing search hits.
- [ ] **Orphan file cleanup** — delete files in `FILES_DIR` with no owning memo row (failed/abandoned uploads); reclaim disk. Report freed bytes.
- [ ] **Dead-link checker** — periodic HEAD on `source_url`; flag 4xx/dead links (new `link_status` field) so the user knows a saved page is gone. Pairs with Localize.

**Content enrichment (memos more useful over time):**
- [ ] **Auto AI summary** — generate `ai_summary` in the background for memos over N words that lack one (reuses `/api/memos/{id}/summary`).
- [ ] **Auto-tagging** — LLM suggests tags for untagged memos; improves filtering/grouping.
- [ ] **Title / favicon refresh** — refetch OG title + favicon for link memos missing them.
- [ ] **Web-card thumbnail backfill** — extend thumb backfill to article/link memos missing a preview image.

**Storage hygiene (lean, fast, no clutter):**
- [ ] **Duplicate detection** — same `source_url` or near-identical content → flag (or offer merge).
- [ ] **Empty / failed-memo flag** — memos with no content + no file = broken ingest; surface for retry or delete.
- [ ] **SQLite VACUUM + ANALYZE** — periodic optimize so the DB stays fast as it grows.
- [ ] **FTS5 index repair** — rebuild full-text index if it drifts from the memo table.

**Data safety:**
- [ ] **Scheduled auto-backup** — periodic structure/full export to disk (reuses backup endpoint); keep last N.

**UX surface (optional):**
- [ ] **Maintenance panel in Settings** — show last-run time + result per job, manual "Run now" buttons, enable/disable toggles.

---

## v1.11.0 — Settings & Identity *(P5)*

- [x] **[G] Feature request flow** — "Send Feedback / Feature Request" button in Settings; pre-filled `mailto:dev@izo.red` with `[OpenMemo Feature Request]` subject + body template. Zero infra *(shipped in v1.7.3)*
- [ ] **[H] Inspiration & credits** — Visual section listing concept inspirations: Milanote, Notion, Readwise Reader, Obsidian, Raindrop.io. Logo + name + one-sentence description per entry
- [x] **[I] Creator card** — "Made by Reda Izo" card with title (Creative Director), brief why-built statement, GitHub link (`https://github.com/izored`), avatar placeholder (`RI` initials in brand color) *(shipped in v1.7.3)*

---

## v2.0.0 — Collaboration *(Future)*

- [ ] **Multi-user / workspace sharing**
- [ ] **Import / export** — Markdown, Notion, Obsidian vault import
- [ ] **Plugin system** — Custom extractors and chat middleware
- [ ] **Self-hosted cloud deploy** — One-click VPS / homelab deploy

---

## Backlog *(unversioned)*

- **User flow diagram** — Full UX flow diagram for birds-eye view of journeys across Dashboard, MemoDetail, Collections, Chat, Settings
- **Multimedia icon Lottie animation** — FAB animated icon; spec at [`Specs/multimedia-icon-animation.md`](./multimedia-icon-animation.md)
- **List view & Timeline view** — Alternatives to card grid
- **Built-in code viewer / light editor** — `code` is its own memo type (uploaded source files only — not text notes). Add an in-app syntax-highlighted viewer, and later a light editor, for code memos. Reuse an open-source editor (CodeMirror 6 — already a transitive dep via MDXEditor, or Monaco) rather than building from scratch. Detail page renders the file with language detection + copy button; editor phase allows in-place edits saved back to the file.
- **[Y] Remove Claude attribution from codebase** — Audit code comments, generated headers, UI text. Claude disclosed in README only

---

## Destructive — Requires Explicit Approval

- **[X] Rewrite git history to remove first commit** — `git rebase -i --root` drop or `git filter-repo` + force push to main. Invalidates all forks/clones. **Do not run without explicit user confirmation each time.**

---

## Archived / Cancelled

- ~~**v1.7.1 Public Sandbox**~~ — Live demo instance resetting nightly. Deprioritized indefinitely.

---

## Bento Grid Spec

Full spec for **[C]** in v1.8.5.

### Part A — Grid System
`MemoGrid.tsx` switches to:
- `display: grid`
- `grid-template-columns: repeat(4, 1fr)` (4-col desktop)
- `grid-auto-rows: 280px`
- `gap: 1rem`

Breakpoints: xl 4 cols → lg 3 → md 2 → sm 1 (full-width, ignore span).

### Part B — Size Library
```ts
export type CardSize = '1x1' | '2x1' | '1x2' | '2x2' | '3x1' | '1x3'
```
Span map: `1x1`→1×1, `2x1`→2×1, `1x2`→1×2, `2x2`→2×2, `3x1`→3×1, `1x3`→1×3.
DB: `card_size VARCHAR DEFAULT '1x1'` migration via `migrate_collections.py` pattern (PRAGMA-check first). Add `card_size?: CardSize` to `Memo` interface, include in `update_memo()`.

### Part C — Content-Aware Defaults
- image → `1x1`
- video → `2x1`
- note → `1x2`
- article → `2x1`
- document → `1x1`
- link → `1x1`
- audio → `2x1`

### Part D — Resize UI
Hover handle bottom-right (Lucide `<LayoutGrid>`). Click → popover with 6 size proportional previews. Click size → `memoApi.update(id, { card_size })` + invalidate `['memos']`. Same `opacity-0 → group-hover:opacity-100` pattern as delete button.

### Part E — MemoCard Adapts
- `1x1`: title + type badge + date
- `2x1`: title + 2-line desc + type badge
- `1x2`: title + 4-line desc + type badge + date
- `2x2`: thumbnail + title + desc + tags + date
- `3x1`: horizontal — thumbnail left, content right
- `1x3`: large thumbnail + full title + desc + AI summary snippet

### Part F — DnD Compatibility
Apply spans inside `SortableMemoCard` style:
```ts
style={{
  gridColumn: `span ${span.colSpan}`,
  gridRow: `span ${span.rowSpan}`,
  ...dndStyle,
}}
```
Drag-to-collection + drag-to-reorder must keep working. No external grid lib — pure CSS Grid. No visual change to card colors/radius/shadows.

---

## Session Rules (always)

- Never hardcode colors — `var(--color-*)` only
- Reuse `<MarkdownEditor>`, `<PageBox>`, `<BackButton>`, `<Card>` — never duplicate
- DB migrations follow `migrate_collections.py` pattern; `PRAGMA table_info()` before any `ALTER TABLE`
- All user input through `sanitize.py`
- Commit after each completed item with clear message
