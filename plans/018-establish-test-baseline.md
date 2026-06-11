# Plan 018: A characterization-test baseline covers the critical paths (memo lifecycle, RAG scoping, security helpers) and a frontend component harness exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- backend/tests backend/services/memo_service.py backend/core/rag.py backend/core/security frontend/src`
> Tests characterize CURRENT behavior. If the underlying code changed since
> this plan was written, write the tests against the code as it is now, not
> against these excerpts.

## Status

- **Priority**: P1 (foundational — makes every other fix verifiable)
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none. Best done early so other plans inherit coverage; but it can
  land any time.
- **Category**: tests
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

The repo has almost no automated coverage of its critical paths. Backend tests are
3 files (a smoke test + two playlist guards); frontend has 4 lib tests and **zero**
component/page/store/hook tests. The FTS5 dead-code bug (`plans/001`) shipped and
stayed invisible precisely because nothing exercised it. This plan establishes a
characterization baseline — tests that pin down how the code behaves today on the
paths that matter (memo create→embed→delete→restore, RAG collection scoping, the
security helpers `SafePath`/`validate_url`/`escape_fts5_query`) — plus a minimal
frontend component-test harness so UI plans (`plans/010/011/015/016/017`) have
somewhere to add tests. Coverage here is a force multiplier for all the other plans.

## Current state

- Backend tests: `backend/tests/{conftest.py, test_smoke.py, test_playlist_feed_filter.py, test_playlist_ingest_dedupe.py}`.
  `pytest-asyncio` is configured (read `conftest.py` + `backend/pytest.ini` for the
  async mode and fixtures). CI runs `pytest tests/ -v` (working dir `backend/`).
- Critical untested code:
  - `backend/services/memo_service.py` — all memo CRUD goes through here.
  - Memo lifecycle endpoints in `backend/api/memos.py` (delete = soft delete,
    restore re-embeds) and `backend/api/ingest.py` (`process_memo`).
  - `backend/core/rag.py` — `rag_chat` retrieval/scoping.
  - `backend/core/security/sanitize.py` — `SafePath`, `validate_url`,
    `escape_fts5_query`, `sanitize_workspace_id`, `sanitize_filename`.
- Frontend tests: `frontend/src/lib/{media,platforms,playlistUrl,utils}.test.ts`
  (vitest). `jsdom` is already a devDependency and `npm test` runs vitest. There is
  NO component-render harness yet (no `@testing-library/react`).
- Vitest config: read `frontend/vite.config.ts` (or `vitest.config.ts`) to see the
  test environment setting; `jsdom` is installed so a DOM env is available.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend tests (root) | `pytest backend/tests/` | all pass |
| Backend coverage view (optional) | `pytest backend/tests/ -v` | lists tests |
| Frontend tests (`frontend/`) | `npm test` | all pass |
| Frontend build (`frontend/`) | `npm run build` | exit 0 |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `backend/tests/test_memo_lifecycle.py` (create)
- `backend/tests/test_rag_scoping.py` (create)
- `backend/tests/test_security_helpers.py` (create)
- `frontend/src/test/setup.ts` (create — harness setup, if needed)
- `frontend/src/components/MemoCard.test.tsx` (create — first component test)
- `frontend/package.json` + `frontend/vite(st).config.ts` (only to wire
  `@testing-library/react` if absent)

**Out of scope**:
- Changing any application code to make it testable beyond the minimum. If a path
  is genuinely untestable without a refactor, note it as a STOP/follow-up rather
  than refactoring here.
- E2E/Playwright — not in this plan (note as a follow-up).
- Backend lint/type tooling (ruff/mypy) — separate concern.

## Git workflow

- Branch: `advisor/018-establish-test-baseline`
- Commit per area (backend lifecycle, backend rag, backend security, frontend
  harness+first test). Conventional style: `test(memo): characterize soft-delete and restore lifecycle`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Read the existing fixtures

Read `backend/tests/conftest.py` and `backend/tests/test_playlist_*.py` to learn:
the async test mode, how a DB session/`TestClient` is provided, and how they create
memo rows. **Mirror these fixtures exactly** — do not invent a parallel setup.

**Verify**: you can state how to (a) get an async DB session and (b) create a memo
in a test.

### Step 2: Backend — memo lifecycle characterization

Create `backend/tests/test_memo_lifecycle.py`. Characterize current behavior (monkeypatch
`embed_memo` so no Ollama/Chroma is needed):
- Create a memo (via `memo_service` or the create endpoint) → it exists, listed by
  `GET /api/memos`.
- Soft delete → `is_deleted` true; excluded from `GET /api/memos`; present in the
  deleted list endpoint.
- Restore → `is_deleted` false; re-listed; restore schedules processing
  (monkeypatch to assert it's called).
- Playlist-born exclusion (already partly covered) — add only if not redundant with
  `test_playlist_feed_filter.py`.

**Verify**: `pytest backend/tests/test_memo_lifecycle.py -v` → pass.

### Step 3: Backend — RAG scoping characterization

Create `backend/tests/test_rag_scoping.py`. Monkeypatch `search_similar` and the
token stream source (read `rag.py` for the exact symbols) so no network is used:
- With sources returned, `rag_chat` yields a `sources` event then `token` events.
- With NO sources, it yields the `NO_CONTEXT_MESSAGE` token and stops (no LLM call).
- `collection_id`/`memo_id` are passed through to `search_similar` (assert the call
  args) — this pins the scoping contract.

(If `plans/009` has landed, the deleted-filter test lives there; don't duplicate.)

**Verify**: `pytest backend/tests/test_rag_scoping.py -v` → pass.

### Step 4: Backend — security helpers

Create `backend/tests/test_security_helpers.py`. These are pure functions — easy,
high-value:
- `escape_fts5_query`: wraps terms in quotes, strips control chars, empty → `""`.
- `validate_url`: accepts `https://example.com`; rejects `file://...`, missing
  scheme. (If `plans/003` landed, private-host rejection is tested there — don't
  duplicate; otherwise just test the scheme rules as they currently are.)
- `sanitize_workspace_id` / `sanitize_filename`: characterize current sanitization
  (e.g. path separators stripped from filenames). Read the functions first and
  assert what they actually do today.
- `SafePath`: a path inside the base resolves; a `../` escape is rejected. Read the
  class to use its real method names.

**Verify**: `pytest backend/tests/test_security_helpers.py -v` → pass.

### Step 5: Frontend — add a component-test harness

If `@testing-library/react` is not already present, add it (and
`@testing-library/jest-dom`, `@testing-library/user-event`) as devDependencies:
`npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event`
(from `frontend/`). Configure the vitest test environment to `jsdom` and a setup
file:
- In `frontend/vite.config.ts` (or a `vitest.config.ts`), set
  `test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', globals: true }`
  — merge with existing config, don't clobber it. Read the current config first.
- Create `frontend/src/test/setup.ts` with `import '@testing-library/jest-dom';`.

**Verify**: `npm test` (from `frontend/`) → existing lib tests still pass under the
updated config.

### Step 6: Frontend — first component test

Create `frontend/src/components/MemoCard.test.tsx`. Render `MemoCard` with a fake
memo inside the providers it needs (TanStack `QueryClientProvider`, a router if it
uses `useNavigate`, and the Zustand store as-is). Assert it renders the memo title
without throwing. Keep it minimal — the goal is proving the harness works so other
UI plans can build on it.

This may require wrapping in providers; build a small `renderWithProviders` helper
in `src/test/` if useful. Mock `frontend/src/lib/api.ts` if the card fetches on
mount.

**Verify**: `npm test` → the new test passes alongside the lib tests.

### Step 7: Full runs

**Verify**: `pytest backend/tests/` → all pass; `npm test` (from `frontend/`) → all
pass; `npm run build` (from `frontend/`) → exit 0.

## Test plan

- This plan *is* the test plan. New files: 3 backend characterization suites + a
  frontend harness + 1 component test.
- All network/LLM/vector calls are monkeypatched; tests are fast and offline.
- Verification: `pytest backend/tests/` and `npm test` both green, including the new
  files.

## Done criteria

ALL must hold:

- [ ] `backend/tests/test_memo_lifecycle.py`, `test_rag_scoping.py`, `test_security_helpers.py` exist and pass
- [ ] `pytest backend/tests/` exits 0
- [ ] A frontend component-test harness exists (`@testing-library/react` + jsdom env + setup file)
- [ ] `frontend/src/components/MemoCard.test.tsx` renders the card and passes
- [ ] `npm test` exits 0 (lib tests + new component test); `npm run build` exits 0
- [ ] No application source changed beyond test wiring (`git status` — only tests + config + package files)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- A critical path can't be tested without refactoring app code — list which, and
  what minimal seam would unblock it; do NOT refactor app code in this plan.
- The existing `conftest.py` fixtures can't create a memo row and the workaround is
  non-trivial — report.
- Wiring `@testing-library/react` breaks the existing lib tests in a way that isn't
  a config merge fix — report the failure.

## Maintenance notes

- This is a *baseline*, not full coverage. Subsequent plans (`plans/001-017`) each
  add their own targeted tests; this gives them fixtures and a harness to reuse.
- Follow-up deferred: an E2E smoke (save memo → search → chat) via Playwright; and
  backend lint/type tooling (ruff/mypy). Track separately.
- Reviewer should confirm tests assert CURRENT behavior (characterization), so they
  catch regressions rather than encoding wished-for behavior.
- Once this lands, add `npm test` and `pytest` as required gates if not already
  (CI already runs both — confirm they stay green).
