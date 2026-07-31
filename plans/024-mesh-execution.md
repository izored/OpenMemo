# 024 — Mesh: execution tracker

**Living document. Updated at the end of every working turn.**
Design: [`docs/ADR-024-MESH.md`](../docs/ADR-024-MESH.md) · Branch: `claude/openmemo-mac-windows-sync-d89203`

---

## How to resume this work

If you are picking this up cold (new session, context lost, window limit hit):

1. Read `docs/ADR-024-MESH.md` — the full design and the reasoning behind every
   decision. Do not re-litigate settled decisions; the "Rejected" section at the
   bottom records what was already ruled out and why.
2. Read the **Status board** below. It is the source of truth for what is done.
3. Pick the first phase that is not `DONE`. Phases are strictly ordered —
   each assumes the one before it landed.
4. Run the **drift check**: `git log --oneline -10` and confirm the files listed
   in the phase are as the plan describes. This repo has parallel agent threads.
5. Do the work, run the **3-pass review** (below), update the board, commit.

**Never skip the 3-pass review.** It is a hard requirement from the project
owner, not a suggestion.

---

## Status board

Legend: `TODO` · `WIP` · `REVIEW` (code done, passes pending) · `DONE`

| # | Phase | Gated by `mesh_enabled` | Status | Notes |
|---|-------|------------------------|--------|-------|
| 0 | Job queue | **No** — plain infra, fixes live bug | **WIP** | core + tests landed; startup wiring blocked, see below |
| 1 | Mesh flag + Settings section | is the flag | TODO | ADR §0 |
| 2 | `change_log`, triggers, HLC | Yes | TODO | ADR §4, §5 |
| 3 | Merge engine (pure, both directions) | inert lib | TODO | ADR §6, §10 |
| 4 | Journal, snapshot, rollback | Yes | TODO | ADR §13 |
| 5 | Transport + protocol (manual address) | Yes | TODO | ADR §2, §14 |
| 6 | Verification dialogue | Yes | TODO | ADR §7 |
| 7 | Magnet records + resolver | Yes | TODO | ADR §1, §8 |
| 8 | Mesh code, discovery, pairing, roles | Yes | TODO | ADR §2, §3 |

**Shippable checkpoints.** Phase 0 ships alone (bug fix). Phase 5 is a complete
product on its own — library, transcripts and summaries sync end to end, paired
by typing an address. Phases 6–8 are polish and plug-and-play on top.

---

## The 3-pass review (required after every phase)

Each phase is not `DONE` until all three passes run and their findings are fixed.
Record the outcome in the phase log below — including "no findings", which is a
real result worth recording.

| Pass | Focus | Looks for |
|------|-------|-----------|
| **1 — Correctness** | Does it do what the ADR says? | Logic errors, wrong merge outcomes, off-by-one in HLC/leases, unhandled async failure, transactions left open, error paths that swallow |
| **2 — Safety & data integrity** | Can it lose or corrupt data? | Anything writing user data without a journal entry, non-idempotent replays, SQL injection, path traversal, race conditions between workers, secrets reaching logs or the wire, `mesh_enabled=false` paths that still execute |
| **3 — Fit & simplicity** | Does it belong in this codebase? | Duplication of existing helpers (`resolve_memo_path`, `_sqlite_backup`, the `transcribe` lock), naming drift from repo conventions, dead abstraction, missing tests for the stated invariant, docs/CHANGELOG not updated |

Fix findings between passes, not after all three. A pass that produces fixes is
re-run.

---

## ⚠️ START HERE NEXT SESSION — finish Phase 0

The queue core **and** its startup wiring are committed and stable (94 passed,
verified over 5 consecutive full runs). One task remains.

### Migrate the ~25 call sites

Replace fire-and-forget background tasks with `enqueue`:

| file | sites |
|---|---|
| `backend/api/ingest.py` | ~17 `background_tasks.add_task` + 1 `asyncio.create_task` (line 297) |
| `backend/api/memos.py` | 5 |
| `backend/api/music.py` | 1 |

Steps:

1. Create `backend/core/job_handlers.py` that imports the existing task
   functions and registers one handler per kind. **Import it from `main.py`
   before `start_workers()`** — `start_workers` is a no-op while `_HANDLERS` is
   empty, so an unimported handler module means a silently idle queue.
2. Suggested kinds and caps: `process` 2, `thumbnail` 4, `localize` 3,
   `transcribe` 1 (it already needs `transcribe._infer_lock`), `embed` 1,
   `playlist_download` 1.
3. Swap `background_tasks.add_task(fn, memo_id)` →
   `await jobs.enqueue("kind", memo_id=memo_id)`. Note the signature shift:
   handlers take a single `payload` dict, so a task taking extra args
   (`localize_memo_task(memo_id, "audio")`) passes them via `payload`.
4. Keep `BackgroundTasks` in the route signatures where FastAPI needs it, or
   remove the param if nothing else uses it.

Then run review passes 2 and 3, and only then mark Phase 0 `DONE`.

**Watch for:** `enqueue` raises `ValueError` for an unregistered kind. That is
deliberate (fail loudly rather than drop work silently), but it means a typo in
a kind string becomes a 500 on an ingest route. Cover each kind with a test.

---

## Phase log

Newest entry at the top. One entry per working turn.

### 2026-07-31 (later still) — blocker root-caused and fixed, wiring landed

The previous entry's blocker is resolved. It was **not** what it looked like.

- Bisected further: the trigger was not `start_workers` spawning workers (with
  no handlers it spawns none) but **`reclaim()` doing database I/O inside the
  lifespan startup**. Replacing the write with a read-only `SELECT` still broke
  a test, so it was not write-lock contention specifically.
- The failure was **intermittent** (3 failed, then 1, then 0 across identical
  runs) — a race between the app's startup query and the raw `sqlite3`
  connection `test_playlist_feed_filter._db_exec` uses to set `audio_kind`
  straight on the DB. When that UPDATE lost the race the column stayed NULL, so
  an `audio_kind=music` filter matched nothing and the list came back empty.
- **Rejected the tempting fix.** Making `start_workers` a no-op when no handlers
  are registered would have gone green immediately and hidden the bug until the
  call sites were migrated and handlers actually existed.
- **Real fix:** startup does no database I/O at all. A new `_janitor` task owns
  every reclaim and runs its first sweep one poll interval later, in the
  background. This is better design regardless — nothing sits between boot and
  serving traffic — and it removed the need for a separate APScheduler cron
  entry. `start_workers` is still a no-op with no handlers, but now that is a
  statement about there being nothing to run, not a workaround.
- Hardened `_db_exec` with an explicit `busy_timeout`. On its own it only
  narrowed the window (still 2/1/0 failures across runs), so it is defence in
  depth, not the fix.
- Verified over **5 consecutive full-suite runs: 94 passed every time.**

### 2026-07-31 (later) — Phase 0 core landed, wiring blocked

- Built `backend/core/jobs.py`: persistent `job_queue` table, two-step atomic
  claim (works without SQLite 3.35 `RETURNING`), lease-based crash recovery,
  per-kind concurrency caps, priority ladder, retry with exponential backoff.
- Added `backend/tests/test_jobs_queue.py`, 7 tests. Full suite **94 passed**.
- Wired `create_table()` into `_run_migrations()`. Verified safe in isolation.
- **Review pass 1 (correctness) run on my own code before wiring — 3 real bugs
  found and fixed:**
  1. *Jobs stranded for an hour after every restart.* `reclaim()` only requeued
     jobs whose lease had **expired**, but a job interrupted by shutdown keeps a
     fresh 1-hour lease. Split into `reclaim(all_running=True)` for startup
     (a job cannot be running if the process was down) vs lease-expiry for the
     periodic sweep. Regression test added.
  2. *Awaiting a DB write inside an `except CancelledError` block.* The write
     would itself likely be cancelled and raise from inside the handler. Removed;
     startup reclaim covers the case without burning a retry attempt.
  3. *Dedupe was advisory, not enforced.* The read-then-insert in `enqueue()`
     races. Added a partial unique index on `(kind, memo_id) WHERE state IN
     ('queued','running')` and catch `IntegrityError`.
- **Blocked** on the lifespan regression above. Reverted that hunk so `main` and
  this branch stay green.
- Review passes 2 (data safety) and 3 (fit/simplicity) **not yet run** — they
  wait until the wiring lands, since they need to review the finished phase.

### 2026-07-31 — Design complete, artifacts committed

- Named the feature **Mesh**. Checked for collisions: `link` was rejected
  (`Memo.type == 'link'` already exists); `mesh` appears once in the repo, in a
  rejected Tailscale option in `docs/DECISIONS.md`, so it is free.
- Moved the design doc `Specs/device-sync.md` → `docs/ADR-024-MESH.md`.
  **Reason: `Specs/*` is gitignored** (only ROADMAP and two others are
  allowlisted), so the design would never have been committed.
- Added ADR §0: the feature-flag architecture. Triggers are created on enable and
  dropped on disable rather than `WHEN`-gated, so a user who never enables Mesh
  pays zero per-write cost.
- Added `scripts/blob-split.py` — the measurement behind the 94/6 split. Re-run
  it as the library grows; if the re-derivable share drops a lot, revisit §1.
- Status: no implementation code written yet. Phase 0 is next.

---

## Decisions locked (do not re-open without a reason)

These were argued through and settled. The ADR's "Rejected" section has the full
list; these are the ones most likely to be second-guessed by a future session.

- **No account, no relay.** The 12-word Mesh code *is* the identity (§2).
- **The primary device does not win merges** (§3). It owns Telegram polling,
  cron and heavy AI by default, and gets the preselected radio button in the
  conflict dialogue. That is all. A merge-primary would make the MacBook unsafe
  to write to, which contradicts the owner's own "never break any device's
  content" requirement.
- **Ship magnets, not bytes** (§1). Measured: 23.66 GB re-derivable vs 1.58 GB
  that must cross the wire.
- **Transcripts and summaries travel as metadata, never regenerated** (§10).
- **Job queue before sync** (§9). Non-negotiable ordering.

---

## Known risks carried into implementation

| Risk | Where it bites | Mitigation |
|---|---|---|
| Migrating 25 `add_task` call sites touches most of the ingest path | Phase 0 | Ships and is verified alone, before any Mesh code exists |
| Telegram `getUpdates` race if two devices poll one token | Phase 8 | Primary flag guards the poll loop; see `telegram_relay.py:61` |
| SQLite triggers fire inside app transactions | Phase 2 | Keep trigger bodies to a single INSERT; no subqueries over big tables |
| Refetched media is equivalent, not byte-identical | Phase 7 | `sha256` verifies peer transfers only, never refetches |
| Clock drift between devices | Phase 2 | HLC, never wall-clock comparison |
| Docker Desktop cannot do mDNS | Phase 8 | Only the Mac advertises; Windows dials outward |
