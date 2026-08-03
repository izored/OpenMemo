# Plan Execution Progress

Live status log for executing `plans/001`–`plans/018`. Updated as work proceeds.

- **Worktree:** `interesting-kapitsa-43d6b4` (branch `claude/interesting-kapitsa-43d6b4`)
- **Plans written against:** `d847160`
- **Execution started at HEAD:** `467bb84` (drift exists — run each plan's drift check first)
- **Started:** 2026-06-14

## Execution order (chosen)

Per README: 018 (test baseline) early → security → bugs → perf/debt.
Working order: 018 → 001 → 002 → 003 → 004 → 005 → 006 → 007 → 009 → 008 → 010 → 011 → 012 → 013 → 014 → 015 → 016 → 017

## Status table

| Plan | Title | Priority | Status | Notes |
|------|-------|----------|--------|-------|
| 018 | Characterization-test baseline + FE harness | P1 | DONE | backend 43 pass, frontend 46 pass, build green |
| 001 | Fix FTS5 undefined-function | P1 | DONE | imported canonical escaper, removed dead `_escape_fts5`; +test_fts5_escape.py |
| 002 | Block Zip-Slip in backup restore | P1 | DONE | validate all entries before DB replace + wipe; +3 tests |
| 003 | Validate proxy/image URLs (SSRF) | P1 | DONE | proxy routes through validate_url; private-host block implemented; +SSRF tests; updated 018 localhost test |
| 004 | Scope CORS extension origin | P2 | DONE | EXTENSION_ORIGIN setting; regex falls back only when unset |
| 005 | Bump vulnerable dev deps | P3 | DONE | vitest ^3.2.6 + audit fix (brace-expansion, ws); esbuild/vite high-sev left (needs breaking vite@8) |
| 006 | Enable SQLite WAL + busy_timeout | P1 | DONE | connect-event listener sets WAL/busy_timeout/synchronous; +pragma test; sidecar cleanup added as 002 follow-up |
| 007 | Surface + retry silent embed failures | P1 | DONE | embed_status col + migration; error/ok persisted; schedule_processing helper; /reembed; +5 tests |
| 009 | Drop deleted memos from RAG sources | P2 | DONE | rag_chat filters sources vs live memo rows; +2 tests; fixed 018 rag-scoping test |
| 008 | Persist assistant reply on disconnect | P2 | TODO | |
| 010 | Abort SSE readers on unmount | P2 | TODO | |
| 011 | Fix notes-autosave clobber | P2 | TODO | |
| 012 | Truncate list content_text in SQL | P3 | TODO | |
| 013 | Migrate PyPDF2 → pypdf | P3 | TODO | |
| 014 | Backfill `.env.example` | P3 | TODO | |
| 015 | Extract `useMemoMutations` hook | P3 | TODO | blocks 016 |
| 016 | Targeted query invalidation | P3 | TODO | needs 015 |
| 017 | Split MemoDetail component | P3 | TODO | easier after 011, 015 |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (reason)

## Log

- 2026-06-14 — Created tracker. Verified worktree HEAD `467bb84` vs plans base `d847160`; drift handling per-plan.
- 2026-06-14 — **018 DONE.** Fixed a pre-existing test-infra bug: `_run_migrations()` opens `DATA_DIR/openmemo.db` directly while `init_db()` builds tables on the `DATABASE_URL` engine; in tests these diverged → "no such table: memos". Aligned both in `conftest.py` (set `DATA_DIR` + `DATABASE_URL` to one throwaway dir). Added `test_memo_lifecycle.py` (5), `test_rag_scoping.py` (4), `test_security_helpers.py` (26). Added FE harness: `@testing-library/react` + `vitest.config.ts` merge of vite config + `src/test/setup.ts` (jest-dom + localStorage shim) + `renderWithProviders` + `MemoCard.test.tsx` (2). pytest 43 pass, vitest 46 pass, `npm run build` exit 0.
- 2026-06-14 — **Pre-existing issue flagged (NOT a plan):** `npm run lint` is RED on this branch — 10 errors in drift files `MusicAddModal.tsx`, `SidebarPlayer.tsx` (unused `upNextOpen`/`UpNext`), `VolumeControl.tsx`, `playlistUrl.ts:65` (useless escape), `MemoDetail.tsx:336` (set-state-in-effect) + `:1552` (constant truthiness). Not introduced by 018; no plan covers them. CI `lint` gate would fail until fixed.
- 2026-06-14 — **001 DONE.** No drift. `fts5.search_fts5` called undefined `escape_fts5_query` (NameError swallowed by search.py → silent ILIKE fallback). Imported canonical `escape_fts5_query` from `backend.core.security`, deleted the duplicate `_escape_fts5` + its lone `import re`. Added `test_fts5_escape.py` (2). Import smoke OK, pytest 45 pass. Changelog entry added.
- 2026-06-14 — **009 DONE.** No drift on rag.py. After `search_similar`, `rag_chat` now queries live (non-deleted, NULL=live) memo ids and filters the source list before the sources event + no-context short-circuit — so Ask Memo can't cite a ghost vector left by a failed Chroma purge. Added `test_rag_excludes_deleted.py` (2: deleted filtered out; all-deleted → NO_CONTEXT, no LLM). **Regression caught + fixed:** the 018 `test_rag_scoping::test_with_hits` used a fake memo_id with no DB row, which the new filter dropped → updated it to create a live memo via the API (added a `client` fixture there). pytest 65 pass.
- 2026-06-14 — **007 DONE.** ingest.py drifted +745 (new music code) but `process_memo` + `embed_memo` signature matched the excerpt. Model uses `Column(...)` not `Mapped` — added `embed_status = Column(String, nullable=True)` accordingly + guarded migration. `process_memo` now persists `embed_status="ok"`/`"error"` (failure path commits the error — the original bug was persisting nothing). Added `schedule_processing` (create_task + done-callback that logs exceptions); replaced both `create_task(process_memo)` sites; added `POST /{id}/reembed`; surfaced `embed_status` in list (load_only + dict) and detail. Added `test_embed_status.py` (5) — async tests create via the endpoint so the lifespan builds the schema first. pytest 63 pass. Frontend retry button deferred per plan. Changelog entry added.
- 2026-06-14 — **006 DONE.** Engine block matched plan. Added a `connect` event listener on `engine.sync_engine` setting `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL` per connection. Added `test_sqlite_pragmas.py` (2) reading the pragmas back through the app engine. pytest 58 pass. **Step 3 finding:** restore in `backup.py` did NOT clean `-wal`/`-shm` sidecars; per README this is the anticipated 002 follow-up. Rather than leave WAL-unsafe restore, folded sidecar checkpoint/removal into a separate 002-follow-up commit (kept out of the 006 commit to honor 006's scope).
- 2026-06-14 — **005 DONE (dev-only, no changelog).** Advisories moved since the plan: the live root is now an `esbuild`/`vite` chain (high) whose only fix is a breaking `vite@8` (`--force`) — left untouched per plan (don't force). Bumped `vitest ^3.0.0 → ^3.2.6` and ran `npm audit fix` (no force), clearing the `brace-expansion` + `ws` moderates. Only the vitest devDependency changed; no production deps. `npm test` 46 pass, `npm run build` exit 0. **Caveat:** `npm run lint` still RED on pre-existing drift errors (see 018 note) and 6 high esbuild/vite advisories remain pending a deliberate vite major bump.
- 2026-06-14 — **004 DONE.** main.py drifted but CORS block matched. Added `EXTENSION_ORIGIN` setting (config.py, default ""); `.env.example` already existed (subset) — documented the new var there. Middleware now appends EXTENSION_ORIGIN to allow_origins and sets `allow_origin_regex=None` when it's configured (wildcard fallback only when unset). `CORS_ORIGINS` validator already coerces to list so `list(...)` is safe. Verified both default + with-id imports. pytest 56 pass. Changelog entry added.
- 2026-06-14 — **003 DONE.** main.py drifted (+41 lines) but proxy_image still matched the excerpt; sanitize.py clean. Replaced the weak `startswith("http")` check in `proxy_image` with `validate_url`. Implemented the private-host SSRF block in `validate_url` (rejects localhost/0.0.0.0/.local + loopback/private/link-local/reserved/multicast via `socket.getaddrinfo` + `ipaddress`). Now affects all callers (ingest, headless). Added `test_proxy_image_ssrf.py` (8); updated the 018 `test_validate_url_currently_allows_localhost` → `..._rejects_localhost`. Note: redirect-based SSRF still open (proxy uses follow_redirects=True) — deferred per plan. pytest 56 pass. Changelog entry added.
- 2026-06-14 — **002 DONE.** No drift. Restore unpacked zip entries with no containment check (Zip-Slip) and wiped files dir before reading the archive. Used option B (manual `is_relative_to`) since `SafePath.resolve` raises 404 not the wanted 400. Validate every `files/`-prefixed entry's resolved dest against `files_dir` BEFORE the DB replace and the wipe; write only from the vetted list. Added `test_backup_restore_safety.py` (3): malicious entry → 400 + nothing escapes, benign restore lands under files dir, rejected archive doesn't wipe existing files. Tests monkeypatch `settings.FILES_DIR`/`DATA_DIR` to tmp so the real DB is untouched. pytest 48 pass. Changelog entry added.
