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

## ⚠️ START HERE NEXT SESSION — Phase 0 blocker

`backend/core/jobs.py` and its tests are committed and green (94 passed). Two
things remain before Phase 0 is `DONE`.

### 1. Startup wiring causes a test regression (must debug first)

Adding `await jobs.start_workers()` to the `main.py` lifespan makes
`backend/tests/test_playlist_feed_filter.py` fail 4 of 5 tests — the memo list
endpoint starts returning an **empty set** from the second test onward. The
first test in the file passes, so it is state leaking across TestClient
instances, not a broken query.

Isolated by bisecting the two edits:

| change | result |
|---|---|
| `database.py` migration only (`create_table` in `_run_migrations`) | ✅ 5 passed |
| `+ main.py` lifespan wiring | ❌ 4 failed |

So the queue schema is innocent; the lifespan hook is the trigger. With no
handlers registered `start_workers()` spawns **zero** worker tasks, so it is
almost certainly `reclaim(all_running=True)` opening an `AsyncSessionLocal`
during lifespan startup, interacting badly with the session-scoped test DB and
the per-test event loop. Suspect NullPool + aiosqlite connections bound to a
closed loop.

**Do not commit the wiring until this is understood** — the memo list going
empty is exactly the class of bug that must not reach a user. The reverted hunk,
to reapply once fixed:

```python
# in the lifespan, before the scheduler is created
from backend.core import jobs
await jobs.start_workers()

# alongside the reclassify cron
scheduler.add_job(
    jobs.reclaim,
    CronTrigger(minute="*/15"),
    id="jobs_reclaim_expired",
    replace_existing=True,
)

# in shutdown, before scheduler.shutdown
try:
    await jobs.stop_workers()
except Exception:
    pass
```

Worth trying first: make `start_workers()` a no-op when `_HANDLERS` is empty
(nothing to run, so nothing to reclaim for), which both fixes the symptom and is
correct on its own.

### 2. Then migrate the call sites

25 `background_tasks.add_task` sites in `ingest.py`, `memos.py`, `music.py` plus
bare `asyncio.create_task` in `main.py` and `telegram_relay.py`. Register a
handler per kind and swap `add_task(fn, id)` → `enqueue(kind, memo_id=id)`.
Suggested caps: network/download 3, transcribe 1 (it already needs
`transcribe._infer_lock`), embed 1, thumbnail 4.

Then run review passes 2 and 3, and only then mark Phase 0 `DONE`.

---

## Phase log

Newest entry at the top. One entry per working turn.

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
