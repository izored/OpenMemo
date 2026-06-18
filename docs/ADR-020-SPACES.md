# ADR-020: Spaces are workspaces, not a parallel world. One DB, isolated by `workspace_id`

**Date:** 2026-06-17 · **Status:** Shipped · **Builds on:** ADR-001 (define shared things once, scope across the whole type), ADR-015 (a `kind` column keeps two UIs apart without a parallel data model), ADR-006 (the sidebar is a fixed three-zone column), ADR-016 (every page renders one shared header)

> This file is the living foundation for Spaces. I keep the Progress log at the bottom current as each phase lands, so we never lose the thread. Decisions above the log are the plan; the log is what actually shipped.

---

## Context

For now a memo lands in one of two places: the main dashboard (All Memos) or a collection. That is fine for one library. It breaks down the moment a side project gets big. A real side project wants its own walls: its own collections, its own dashboard, hidden from the main feed, so the everyday library stays clean and the project stays focused.

The tempting design is a parallel world: a separate `.db` per Space, separate ChromaDB, connection routing, cross-DB search. That doubles every concern we already solved (ingest, search, embedding, file serving, deletion) and contradicts the one thing I do want: Space memos still live in the general `openmemo.db`, queryable like everything else.

We already have the right primitive. `Workspace` exists in the schema. Every memo and every collection already carries `workspace_id`. Today only the `'default'` workspace is ever used. Spaces are the feature that finally uses the column.

## Decision

**A Space is a `Workspace` row. No new table, no second database file. Isolation is a `workspace_id` filter, not a separate store.**

### Data model
- `Workspace` gains presentation + ordering columns: `emoji`, `color`, `description`, `icon`, `pinned`, `sort_order`, and `kind` (`'library'` or `'space'`). Additive migration, manual `ALTER TABLE` with a `PRAGMA table_info` guard (no migration framework, per CLAUDE.md).
- The existing `'default'` workspace is the main library: `kind='library'`. It is never listed as a Space.
- A Space is a `Workspace` with `kind='space'`. Its memos and collections carry that workspace's id. All rows stay in one `openmemo.db`.

### Isolation
- List endpoints default to `workspace_id='default'` when none is passed. That is the line that keeps Space memos out of the main dashboard, the main collections page, pinned, stats, search, and music, with no per-call opt-out needed.
- Space surfaces pass `?workspace_id=<spaceId>` explicitly. Same endpoints, scoped.
- Ingest already accepts `workspace_id`. The frontend passes the active Space so adds land inside it.

### Surfaces
- **Sidebar** grows a Spaces section with a `+` to create. It is an accordion: opening a Space expands its collections as a dropdown and retracts the library nav and any other open Space. One thing open at a time.
- **`/spaces`** is the Spaces library: a grid of Space cards plus create.
- **`/space/:id`** is the Space home: the Dashboard grid scoped to the Space, under its own distinct header (cover, name, description, stats). This is the one page that does not reuse the standard `PageHeader` chrome unchanged (ADR-016 exception, documented here on purpose).
- Add modal / panel is context-aware: when a Space is active, the target defaults to that Space.

### Delete policy (destructive, heavily guarded)
Deleting a Space deletes the Space, its collections, **and all of its memos**. This is the one irreversible action in the app, so it is gated hard:
1. **Step one:** a plain confirm explaining exactly what dies (the Space, N collections, M memos).
2. **Step two:** the user must type an exact confirmation sentence into a text field. The button stays disabled until the typed string matches. No muscle-memory click can trigger it.
3. **Backup first:** before the delete runs, offer (default on) an export of the whole Space (its memos + collections) to a file, so a mistake is recoverable. Delete proceeds only after the export is written or explicitly skipped.

We do not silently move memos to the library on delete. Delete means delete. The guardrails exist so the user always knows that.

## Consequences
- Every memo feature works inside a Space for free: detail page, pin, search, summarize, drag onto a collection, thumbnail edit. Same tables, same pipelines.
- The isolation default is a single chokepoint. Any new list endpoint must opt into the same `workspace_id` default, or Space content leaks into the main library. This is the thing most likely to regress; it gets a test.
- ChromaDB stays one collection. RAG retrieval scopes by `workspace_id` the same way it will scope by collection, so a Space chat never pulls main-library chunks.
- Deleting a Space is the only destructive, unrecoverable path in openMemo. The typed-sentence gate plus the pre-delete export are the safety net.
- The `'default'` workspace id stays hardcoded as the library everywhere (CLAUDE.md rule). Spaces never reuse or shadow it.

## Hidden memos inside a Space

**Status: designed here, not yet built.**

Hidden (OPNMMO-0016) is a per-memo flag (`memos.hidden`), orthogonal to `workspace_id`. A Memo can be hidden and live in a Space at the same time. Spaces do not invent a second privacy model. They compose with the one openMemo already has, the same way isolation composes with the existing list filters.

The behavior, surface by surface:

- **Space home (the catch-all):** excludes hidden Memos, exactly like the main dashboard. The list endpoint already drops hidden Memos when no `collection_id` is asked for, so the Space home gets this for free (`?workspace_id=<space>` with no `hidden`, no `collection_id`).
- **Inside a Space collection:** hidden Memos show, exactly like a library collection. Opening a collection asks for it explicitly (`collection_id` present), which lifts the hidden filter.
- **The Space's hidden section:** each workspace has its own. `GET /api/memos?hidden=true&workspace_id=<space>` returns only that Space's hidden Memos; the library's hidden section is the same call against the `default` workspace. Isolation holds in both directions: a Space's hidden Memos never surface in the library's hidden section, and the library's never surface in a Space's. **No new backend endpoint is needed** — the existing `workspace_id` default and the `hidden` filter already compose (verified in `backend/api/memos.py`).

**One passcode, not many.** The hidden passcode (`app_settings.hidden_passcode`) and the per-tab `hiddenUnlocked` session flag stay **global**. Unlocking once reveals every hidden section, library and Spaces alike. The passcode is the user's "show me what I tucked away" gate, not a per-project secret. A per-Space passcode is a deliberate non-goal for v1 (see Open questions).

**Entry point.** The library reveals its hidden section by dwelling on the Collections "+" (a quiet gesture, never a visible button). A Space mirrors this with its own scoped reveal and a workspace-scoped route, `/space/:id/hidden`. `HiddenPage` becomes workspace-aware: it reads the active workspace and lists hidden Memos for it, behind the same passcode + session unlock.

**Delete and backup already cover hidden Memos.** A Space's destructive delete and its pre-delete export both walk every non-deleted Memo in the workspace, hidden included. So a hidden Memo is backed up before deletion and removed with the rest, and the delete warning's count includes it (correct: it is going too). One nuance to accept: the warning reveals the *count* of hidden Memos in the Space, though never their content. For a single-user local app this is fine.

The only build work is the front end: the per-Space reveal gesture and the workspace-scoped hidden route/page. The data layer is done.

## Open questions
- **Per-Space hidden passcode** (a Space that locks separately from the library, or hides its very existence from the sidebar until unlocked). Deferred: v1 uses one global passcode for every hidden section.
- Per-Space chat model / appearance overrides, or inherit global? (Default: inherit for v1.)
- Moving an existing memo from the library into a Space, and back. (Likely a "Move to Space" action on the memo, post-v1.)
- Manual ordering of Spaces in the sidebar (drag). `sort_order` exists; wiring deferred.
- Export format for the pre-delete backup: reuse the existing `/api/export` shape, scoped to the Space.
- Per-Space chat model / appearance overrides, or inherit global? (Default: inherit for v1.)
- Moving an existing memo from the library into a Space, and back. (Likely a "Move to Space" action on the memo, post-v1.)
- Manual ordering of Spaces in the sidebar (drag). `sort_order` exists; wiring deferred.
- Export format for the pre-delete backup: reuse the existing `/api/export` shape, scoped to the Space.

---

## Progress log

Living checklist. I tick items as they merge and date each entry. `[ ]` todo, `[~]` in progress, `[x]` done.

### Phase 1 — Data model + backend  ✅ done 2026-06-17
- [x] `Workspace` columns added (`emoji`, `color`, `description`, `icon`, `pinned`, `sort_order`, `kind`) — `backend/db/models.py`
- [x] Migration: guarded inline `ALTER TABLE` in `main.py` lifespan, existing rows backfilled to `kind='library'`
- [x] `backend/api/spaces.py` CRUD: list / create / get / update / `POST /{id}/delete` / `GET /{id}/export`
- [x] Isolation: `memos` list, `pinned/list`, `/api/stats`, `collections` list all default to `workspace_id='default'`
- [x] Search already defaults to `workspace_id='default'` and scopes (`backend/api/search.py`) — no change needed
- [~] Music stays library-only for v1 (Spaces have no music surface yet) — revisit if a Space needs playlists
- [x] Destructive delete: server refuses unless `confirm_name` matches the exact Space name; purges embeddings, cascades memo_collections / memo_tags / chat_sessions / memos / collections / workspace
- [x] Pre-delete export: `GET /api/spaces/{id}/export` zips memos as Markdown + a `space.json` manifest
- [x] Isolation regression test — `backend/tests/test_spaces_isolation.py` (5 tests, full suite 14 green)

**Phase 1 note — orphan files:** destructive delete removes memo rows but does not yet unlink their files on disk (cross-env path resolution, ADR-001 file_path quirk). Not a data leak in-app (no row, no ghost vector); a disk-cleanup pass is a follow-up.

### Phase 2 — Sidebar + navigation  ✅ done 2026-06-17
- [x] `Space` type + `activeSpace` store state. NOT persisted: the route is the source of truth (SpacePage re-derives it from the URL). Persisting it made the sidebar show a Space open while the library rendered.
- [x] `spaceApi` in `lib/api.ts`; `workspace_id` threaded into memos list / pinned / collections / stats / ingest (url, note, file). Search already defaulted to the library.
- [x] Sidebar Spaces section + `+` create + a "view all" shortcut to `/spaces`
- [x] Accordion behavior: opening a Space expands its collections; the library Collections **collapse (not hide)** to a header with a chevron, so they stay reachable
- [x] `/spaces` library page (grid of Space cards + create)
- [x] Routing: `/spaces`, `/space/:id`
- [x] `+ New collection` inside the open Space's sidebar section (creates into the Space's workspace)

### Phase 3 — Space home + adds  ✅ done 2026-06-17
- [x] Distinct Space header (own chrome, not the shared PageHeader). Sits below the viewport top (no edge-bleed).
- [x] Space home = Dashboard grid scoped to the Space
- [x] `SpaceModal` rebuilt Notion-style: full-bleed cover band, overlapping emoji tile, borderless title/description, single 22px gutter (fixed the alignment complaints)
- [x] Context-aware add (active Space = default target) with a target-Space chip in the add panel; counts re-invalidated so the delete warning never goes stale
- [x] Two-step + typed-sentence delete UI with a pre-delete backup download

### Phase 3.5 — Notion-style cover (added on request)  ✅ done 2026-06-17
- [x] `workspaces.cover_ext` column + migration; covers stored at `DATA_DIR/space_covers/<id>.<ext>`
- [x] `POST/GET/DELETE /api/spaces/{id}/cover` (image validation, 12 MB cap, cache-busted `cover_url` on mtime)
- [x] Full-bleed cover on the Space header + the modal, with hover "Change / Remove cover" controls
- [x] Cover file unlinked on destructive Space delete; cover API test added

### Phase 4 — Polish  ✅ done 2026-06-17
- [x] Empty states (no Spaces yet → "Create your first Space"; empty Space → isolation copy)
- [x] Design pass on feedback: centered/re-guttered modal, collapse-not-hide collections, header no edge-bleed, icon ring so it doesn't butt the cover, stable sidebar search box, full-width Space grid
- [x] `docs/CHANGELOG.md` entry
- [x] Tests green (6 spaces + 14 suite), tsc + lint clean
- [x] ADR Status → Shipped
- [ ] Mobile drawer behavior for the Spaces accordion (ADR-009) — deferred, revisit on the next responsive pass

### Phase 5 — Hidden memos inside a Space  ✅ done 2026-06-17
- [x] Decision written: hidden composes with isolation; per-workspace hidden section; one global passcode (see "Hidden memos inside a Space")
- [x] Backend confirmed: no new endpoint — `?hidden=true&workspace_id=<space>` already composes
- [x] `HiddenPage` becomes workspace-aware (reads the `:id` route param, lists that workspace's hidden Memos; `/hidden` stays the library)
- [x] Route `/space/:id/hidden` + a per-Space reveal gesture (dwell on the open Space's "New collection" row), behind the existing passcode + session unlock
- [x] Verify: a Space's hidden Memo stays out of the library hidden section and the Space home, and shows inside its collection — `backend/tests/test_spaces_isolation.py::test_hidden_memo_inside_a_space_stays_isolated`

### Entries
- **2026-06-17** — ADR written. Decisions locked with the user: Workspace-backed (one DB), fully isolated from the main dashboard, context-aware adds, destructive delete behind a two-step + typed-sentence confirm with a pre-delete backup. Starting Phase 1.
- **2026-06-17** — Phase 1 shipped (backend). `Workspace` grew the Space columns, the lifespan migration backfills `kind='library'`, `spaces.py` carries full CRUD + export + the name-gated destructive delete, and the four library list surfaces now default to the `default` workspace so Space content never leaks. 5 new isolation tests, full backend suite 14 green. Next: Phase 2 (sidebar + navigation).
- **2026-06-17** — Behavior fixes: the Space home is a catch-all (the workspace-scoped memo query already unions collection members and loose, no-collection memos), and clicking an already-open Space in the sidebar now stays on its home instead of toggling closed to the dashboard. Leaving a Space is the header "openMemo" back button or a library nav item.
- **2026-06-17** — Phases 2 + 3 shipped (frontend) and verified live in the browser: sidebar Spaces accordion, `/spaces` library, `/space/:id` home with its own header, context-aware adds, and the guarded delete. Isolation confirmed end-to-end (a note added in a Space stayed out of the library). Then a design pass on user feedback: centered + re-guttered the modal, collapse-not-hide for library collections, `+ collection` inside a Space, header no longer bleeds off the top. Added Phase 3.5: Notion-style full-bleed, user-changeable cover image per Space (backend + UI + test). 6 spaces tests green.
- **2026-06-17** — Header polish + Phase 4 close-out: rebuilt the Space header so the cover is a block and the identity stacks below it (title can't bleed onto the cover), dropped the on-cover back button (leave via a library nav item), gave the icon a surface ring so it never butts the cover, made the sidebar search box stop resizing on collapse, and fixed the Space grid to render full-width. Status flipped to Shipped; merged to `main` and rebuilt the Docker app.
- **2026-06-17** — Designed Phase 5 (hidden Memos inside a Space). The decision: hidden is a per-Memo flag that composes with isolation, so each workspace gets its own hidden section (`?hidden=true&workspace_id=<space>`, no new endpoint), the Space home excludes hidden and a Space collection shows it (both already true), and one global passcode gates every hidden section. Only the front-end reveal + workspace-scoped route remain to build. Written up in the "Hidden memos inside a Space" section.
- **2026-06-17** — Phase 5 shipped (front end). `HiddenPage` reads the `:id` route param and lists that workspace's hidden Memos (`/hidden` is still the library, `/space/:id/hidden` is the Space), behind the same global passcode + session unlock. The sidebar grew a per-Space reveal: dwelling on the open Space's "New collection" row fades in a quiet "hidden" link, mirroring the library's dwell-on-"+" gesture, scoped to the open Space. No per-Space passcode (deliberate v1 non-goal). Verified end-to-end with a new isolation test: a Space's hidden Memo stays out of the library hidden list and the Space home, shows in its own hidden list and inside its collection. Full backend suite 16 green, tsc + lint clean. Also fixed the test bootstrap so a fresh worktree runs the suite: `conftest.py` now pins `DATA_DIR` and `DATABASE_URL` to one throwaway file, since `_run_migrations` opens `DATA_DIR/openmemo.db` directly while `init_db` builds tables on `DATABASE_URL`.
- **2026-06-17** — Space home extras + sidebar hardening. The Space home got its memo type filters back (shared with the dashboard via `lib/memoFilters.ts`) and a repositionable cover (`workspaces.cover_pos`, a drag-to-set focal point on the header). Then the sidebar was rebuilt for robustness: all variable sections (Spaces, Pinned, Collections) moved into ONE scroll region with the head/search/nav fixed on top and the player/foot fixed on bottom, so opening a Space or toggling a list never resizes the player and never hides Pinned/Collections. Auto-collapse on Space-open was removed (manual toggle only), and a Spaces button was added to the top nav under Collections. Architecture note added to CLAUDE.md so the layout is not re-broken.
