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
| 0 | Job queue | **No** — plain infra, fixes live bug | **WIP** | built, wired, reviewed. Only the call-site migration left |
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

Queue core, janitor, startup wiring and `job_handlers.py` are all committed and
stable (94 passed over 5 consecutive full runs). **Two** tasks remain, and the
first is a genuine unsolved problem — read it before touching anything.

### ~~1. UNSOLVED: registering handlers makes `GET /api/memos` return empty~~ — RESOLVED

Resolved 2026-07-31. Both hypotheses below were tested and **both failed**;
the cause was a third thing. Kept for the record so nobody retries them.

- **Hypothesis 1 (connection churn from polling): disproved.** Raising
  `IDLE_POLL_SECONDS` from 2s to 60s left the failure rate unchanged (3 of 5
  runs either way). At 60s each worker polls exactly once, at startup — which
  narrowed it to the startup burst rather than ongoing churn.
- **Hypothesis 2 (thundering herd / WAL snapshot): disproved.** Staggering each
  worker's first poll with jitter did not fix it and made the failures
  *deterministic* (3 every run) instead of intermittent. Reverted.
- **Actual cause:** `jobs.py` keeps `_workers` and `_shutdown` in **module
  globals**. That is correct for the app, which has one event loop for its
  entire life, but wrong for a suite that builds ~90 TestClients each with its
  own loop. Workers spawned in one test's loop outlived it and interfered with
  the next.
- **Fix:** `OPENMEMO_DISABLE_JOB_WORKERS=1`, set by `conftest.py`. Production is
  untouched and handlers are now registered for real. `test_jobs_queue.py` opts
  back in via `monkeypatch.delenv`, since it drives the pool explicitly inside a
  single loop — the safe way to use it.
- Verified: **94 passed across 5 consecutive full runs**, runtime back to ~8s.

Worth knowing: this means no test currently covers the real startup path with
workers live. If that ever matters, the fix is to give the queue instance scope
instead of module globals rather than to remove the gate.

### 1. (historical detail, kept for context)

Adding one line to `main.py`:

```python
import backend.core.job_handlers  # noqa: F401 — registers the job kinds
```

makes `test_playlist_feed_filter` fail intermittently — **3 of 5 full runs**,
1–3 tests each, different tests each time. The line is currently commented out
with a pointer to this section, so the suite is green.

**What is ruled out** (each verified, do not redo):

| hypothesis | verdict |
|---|---|
| The queue schema / `create_table` in migrations | ❌ innocent — passes 5/5 alone |
| DB I/O during lifespan startup | ✅ was a *real* and *separate* bug, fixed by the janitor. Not this. |
| Write-lock contention with the raw `sqlite3` writer | ❌ a read-only `SELECT` at startup also reproduced it |
| The test helper's UPDATE silently affecting 0 rows | ❌ **disproved** — added `expect_rows=1` with retries to `_db_exec`; it never once fired, so the write always lands |

**Where that leaves it.** The row is written correctly, yet the subsequent
`GET /api/memos` returns `200` with an empty `items` list. So it is a **read**
problem, not a write problem. Registering the handlers spawns 15 workers
(2+2+4+3+1+1+1+1) plus the janitor, each opening a **fresh aiosqlite connection
every 2 seconds** because the engine uses `NullPool` — and aiosqlite runs each
connection on its own thread.

Best next hypotheses, in order:

1. **Thread/connection churn starving the test event loop.** 16 tasks × a new
   connection every 2s, across ~90 TestClient lifecycles. Try raising
   `IDLE_POLL_SECONDS` sharply, or having idle workers back off exponentially,
   and see if the failure rate tracks it. That would confirm load as the cause.
2. **A WAL read snapshot held open by a worker connection**, making the API's
   connection read a stale view. Try `PRAGMA read_uncommitted` off / explicit
   `COMMIT` after the claim SELECT, or wrap `_claim` in an explicit transaction
   that closes promptly.
3. **Workers should not run in tests at all.** Arguably correct regardless: a
   test asserting API behaviour has no business running a background pool. Gate
   `start_workers()` on an env var the conftest sets, and test the queue
   directly (as `test_jobs_queue.py` already does). This is the pragmatic
   escape hatch if 1 and 2 do not pan out — but treat it as a last resort,
   because it stops the suite from ever covering the real startup path.

Do **not** ship the handler import until this is understood. An intermittently
empty memo list is the worst possible failure mode for this app.

### 0. OPEN DECISION — confirm this before writing any code

The owner raised a fair alternative and it is NOT yet settled. Ask first.

**Turnstile (their idea):** leave the work where it is, just make each call site
wait for a free slot. A semaphore. Far smaller change, much lower risk.

**Ticket queue (what is built):** call sites hand work to the queue.

Turnstile fixes the pile-up only. It does NOT survive app close (waiting work
lives in memory), does not retry, cannot be reprioritised when the user clicks
play, and cannot be shown on an Activity screen. The queue was chosen because
Mesh phase 7 needs downloads that survive restarts — a device may fetch 20 GB
over days — and because the owner asked for robust handling of a 40-memo
mass import.

Both are legitimate. If the owner prefers the smaller change, switch to the
turnstile and drop the queue; do not build both.

**The real count is 29 call sites, not 25** (ingest.py 23, memos.py 5,
music.py 1). Earlier notes saying 25 are wrong.

### 2. NEXT UP — migrate the ~25 call sites

**Recommended approach: a shim, not 25 rewrites.** `ingest.py:345` passes
`background_tasks.add_task` into `ingest_url_core` as an injected callable (the
Telegram relay passes its own), so rewriting every site by hand means changing
that signature too. Instead define one adapter that maps a task function to its
kind:

```python
_KIND_BY_FN = {process_memo: KIND_PROCESS, cache_thumbnail: KIND_THUMBNAIL, ...}

async def queue_task(fn, *args) -> None:
    """Drop-in for background_tasks.add_task that routes through the queue."""
```

Then the change at each site is textual — `background_tasks.add_task(` →
`await jobs.queue_task(` — and the injected-callable path keeps working by
passing `queue_task` instead. Every call site is already inside an async route
handler, so the `await` is free.

Sites: `ingest.py` ~17 + one `asyncio.create_task(process_memo(...))` at line
297, `memos.py` 5, `music.py` 1.

Verify after: full suite green ×5, then manually import a playlist and confirm
downloads are capped rather than all starting at once.

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

### 2026-07-31 (end of session) — review passes 2 and 3 done, 2 more bugs fixed

**Pass 2 (data safety) — 2 real bugs, both fixed, both with regression tests:**

1. *An unreadable payload looped forever, invisibly.* `_claim` decoded the
   payload **after** marking the row `running`. A malformed payload therefore
   raised with the job already claimed: the worker logged and moved on, the row
   sat `running` for a full hour-long lease, the janitor requeued it, and it
   failed again — forever, never counting an attempt, never showing as `failed`.
   Now decoded before the claim, and parked as `failed` with the reason.
2. *`LEASE_SECONDS` was a hard ceiling on job duration.* A playlist download
   outliving one hour got requeued by the janitor **while still running**, so
   the same download ran twice at once. Duplicate work is the exact thing this
   queue exists to prevent. Added a lease heartbeat that renews every
   `LEASE_SECONDS / 3` while the handler runs.

**Pass 3 (fit and simplicity) — no bugs.** One note: `stats()` has no API
endpoint yet, so it is unused until the Activity view is built. Deliberate, not
dead code. Confirmed `datetime.utcnow()` matches the rest of the repo
(`models.py`) despite the deprecation warning — consistency wins here.

Queue tests now 9, full suite green.

**Also this session:** promoted the Mesh log in ADR §13 from a rollback
mechanism to a first-class product feature — complete (an unlogged write is a
bug), readable as sentences, attributable, reversible, scoped, bounded. Added
the inline per-memo history surface, a separate connection log, and a hard rule
that the seed and derived keys must never reach a log file, with a test rather
than a habit.

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
