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
| 0 | Job queue | **No** — plain infra, fixes live bug | **DONE** | built, wired, migrated, 3 passes run |
| 1 | Mesh flag + Settings section | is the flag | **DONE** | ADR §0 · verified in the running UI |
| 2 | `change_log`, triggers, HLC | Yes | **DONE** | ADR §4, §5 |
| 3 | Merge engine (pure, both directions) | inert lib | **DONE** | ADR §6, §7, §10 |
| 4 | Journal, snapshot, rollback | Yes | **DONE** | ADR §13 |
| 5 | Transport + protocol (manual address) | Yes | **PARTIAL** | channel + isolation done; row exchange pending |
| 6 | Verification dialogue | Yes | TODO | ADR §7 |
| 7 | Magnet records + resolver | Yes | TODO | ADR §1, §8 |
| 8 | Mesh code, discovery, pairing, roles | Yes | TODO | ADR §2, §3 |
| 9 | Cross-network reachability (overlay) | Yes | TODO | ADR §2 Reachability · **new 2026-08-02** |

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

### 2026-08-02 — Phase 5 PARTIAL: the isolated channel is real, row exchange is not

Phases 3+4 merged (PR #127). This phase delivers the owner's core requirement —
**openMemo never goes online, only a narrow metadata channel does** — and stops
short of moving rows.

**What landed.**

- `server.py` — a **separate ASGI app with a separate routing table on a separate
  port**, whose entire URL space is one WebSocket. Not a route on the app. There
  is no `/api` to walk to and no static mount, so a traversal has nowhere to go.
  Binds loopback by default: a laptop joining a café network must not start
  listening on it.
- `protocol.py` — a **closed** `MessageType` enum, authenticated *before*
  parsing, with replay rejection and a frame-size bound applied before
  decryption. The most powerful verb is "give me these rows"; there is no
  passthrough, proxy or query verb, and an unknown type is refused rather than
  forwarded.
- `secret.py` — one root secret HKDF'd into distinct chain/PSK/content keys.
  Phase 8 swaps the root for a BIP39 seed and nothing downstream changes.
- `session.py` — the conversation, talking to a `Channel` rather than a
  WebSocket, so two sessions are driven against each other in memory with no
  port and no second database.

**Tests worth naming.** Nine parametrised paths (`/api/memos`, `/`,
`/../../etc/passwd`, `/openapi.json`, …) assert the Mesh listener serves none of
them and leaks nothing about the app. One test asserts the payload is not
greppable on the wire. One asserts the message set itself contains no verb that
names a path, command or URL — so a future addition has to justify itself.

**Review pass 1.** The own-id guard fired on every test, because two sessions in
one process share a database and therefore an identity. Correct behaviour, so
the fix was a seam (`local_device_id`) rather than weakening the guard — and it
is the same seam phase 8 needs for a pairing rehearsal without a second machine.

**Review pass 2.** Turning Mesh off now closes the port. A flag that leaves a
socket listening is not off. Listener startup is non-fatal: a busy port must not
stop the app booting, because the app does not need Mesh.

**Not done, deliberately.** Cursor exchange works; applying rows through the
merge engine and journalling each decision does not. That is next, and it lands
alongside the dialogue (§7) rather than before it — there is no point resolving
conflicts until there is somewhere to show them.

Suite: **205 passed** (was 173).

### 2026-08-02 — Phase 4 DONE: the Mesh log, snapshots and rollback

Lands *before* anything writes on another machine's say-so, which was the whole
point of putting it this early in the order.

- `mesh_journal` records every field Mesh changes with `old_value`, `new_value`
  and — the column that matters — **`rule`**. After a bad sync the question is
  never "what changed" but "why did it change", and that is now one query
  instead of an afternoon reasoning about clocks.
- **Snapshots** via sqlite3's own backup API rather than a file copy, which is
  consistent against a live database. ~7 MB each, twenty kept: 150 MB of full
  undo history against a 25 GB library.
- **Rollback** replays a batch backwards. Metadata only, and that is a feature:
  media is re-pullable from its magnet (§1), so history is text rather than
  files.

Two rules that stop rollback making things worse, both tested: an undo writes a
**new** stamp (a fresh edit, not time travel — otherwise the peer sees a stale
value and re-applies exactly what was undone), and an undo is **itself
journaled**, so undoing an undo works.

**Review pass 1 — 2 bugs in my own fresh code.** A mangled SQL string that
duplicated `FROM mesh_journal`, and values round-tripped through JSON on the way
back, which would have stored the string `"true"` into a boolean column.

**Review pass 2 — 1 hardening.** Undo builds `UPDATE {tbl} SET {field}`, so both
identifiers are interpolated rather than bound. They are now checked against the
live schema before use — not because the journal is untrusted today, but because
a table name reaching SQL from a stored row is exactly the shape that becomes an
injection the day something upstream stops validating. Covered by a test that
feeds it `sqlite_master` and a `--` comment payload.

**Review pass 3 — 1 fix.** `shutil` imported and never used.

Suite: **173 passed** (was 162).

### 2026-08-02 — Phase 3 DONE: the merge engine

Phase 2 merged (PR #126). The engine is pure functions — no database, no
network, no clock, every input an argument — so the part that decides whether
the user keeps their work is exhaustively testable without standing up two
machines.

**Three-way, not two-way.** Comparing local against remote cannot tell "you
edited the title, I edited the tags" apart from "we both set the title"; both
just look *different*. So the merge takes a `base` (the row as it stood when the
devices last agreed) and diffs each side against it. Who touched what becomes a
fact instead of a guess, and the common case merges silently. Where `base` comes
from is phase 5's problem.

Field policy: `LOCAL_ONLY` never crosses the wire, `MACHINE` never prompts and
absence never beats presence, `HUMAN` is the only tier that can raise a
conflict, everything else is plain last-writer-wins.

**Every test runs in both directions** via a `both_ways()` helper and asserts
identical output. A merge that depends on which machine is asking is not a merge.

**Review pass 1 — 1 real bug, and the nastiest kind.** The `summaries` union kept
whichever side happened to be called "local", which is different on each machine.
Both libraries would have drifted apart **permanently and silently**, with no
conflict ever raised. Now the base decides when only one side moved, and the HLC
decides when both did. Caught by writing the symmetry test *before* assuming the
union was safe.

**Review pass 2 — no bugs, one guard added.** Audited all 39 `Memo` columns: 17
classified, 22 deliberately plain. A column added later would silently default to
last-writer-wins, which is wrong for machine fields (an empty value could beat a
real transcript) and dangerous for per-device fields (one machine's file path
would sync onto the other). The plain set is now written down, so adding a column
fails a test until someone picks its tier.

**Review pass 3 — no bugs.** Confirmed the tiers cannot overlap.

Suite: **162 passed** (was 133).

### 2026-08-02 — Phase 2 DONE: change log, triggers, hybrid logical clock

Phase 1 merged (PR #125). `core/mesh.py` became a package (`_gate`, `clock`,
`changelog`, `sync_state`) with the public path unchanged.

**The design call that made this small: the clock lives in SQL, not Python.**
SQLite triggers cannot call a Python function, so the usual approach is to have
the app stamp changes — which means the log's order and the database's order can
drift apart under concurrency. Instead `mesh_clock` is a one-row table and each
trigger advances it in the *same transaction* as the write it records. The log
cannot disagree with the data, ever.

Stamps are `0001754092800123-000004-a1b2c3d4`, zero-padded so a plain string sort
equals the logical order — in SQL, in Python, and in a log a human is reading.

Triggers cover memos, collections, tags, workspaces, chat_sessions, messages and
both link tables (`row_id` is `memo|collection`, because the pair is the identity
that gets added or removed). Created on enable, dropped on disable: a user who
never turns Mesh on pays nothing per write.

**Review pass 1 (correctness) — 1 real bug.** `observe()` ignored the peer's
counter when both sides landed on the same millisecond, so the clock could mint
a stamp the peer had already used. Now clears both. Regression test added.

**Review pass 2 (blast radius) — 1 real bug, and a wrong assumption of mine.**
I had written that `device_id` "must travel with the library". That is backwards:
it identifies the **machine** and is the final tiebreak when two devices stamp
the same millisecond, so restoring one backup onto both machines would hand them
the same identity — breaking the total order and misattributing every change.
Restore now mints a fresh id, drops the inherited change log, and re-applies
*this* machine's trigger state so a restore cannot silently switch Mesh on.

**Review pass 3 (fit) — 1 fix.** `sync_state` imported the package that imports
it; it worked only by accident of import order. Now a relative import.

Suite: **133 passed** (was 119 before this phase).

### 2026-08-02 — Requirement change: sync must work away from home

The owner needs the MacBook to sync from anywhere, not just on the home network.
That directly contradicted §2 ("same network required") and the Rejected list
("a relay… is the single thing the user ruled out"), so the ADR is revised
rather than quietly stretched.

**Two things made it much smaller than general P2P NAT traversal:**

1. *The problem is not symmetric.* The Windows box never moves, is always on,
   and is already the primary. Only the MacBook roams. So this is a roaming
   client reaching a fixed home machine — one side needs to be reachable, and it
   is the side that never moves.
2. *The old objection was already half-solved.* Every frame is encrypted with the
   seed-derived key and authenticated by the PSK, so anything in the middle is a
   dumb pipe. What survived was not privacy but **dependency** — something must
   exist and someone must run it.

**Decision: three tiers, one socket.** Reachability is now explicitly a separate
concern from sync, so adding a tier never touches the merge engine, journal or
resolver. Tier 1 LAN via mDNS (unchanged), tier 2 a user-run WireGuard overlay
(Tailscale recommended), tier 3 manual address. Mesh dials a host and port and
cannot tell the difference — **tier 2 needs zero Mesh code changes**.

**Rejected, and why:**

- *A relay we build or host.* The moment openMemo runs infrastructure it stops
  being local-first, gains an outage surface, and becomes something to patch.
- *Port-forwarding.* `docs/DECISIONS.md` records that the local API is
  unauthenticated by design, so forwarding it publishes the whole library. Even
  forwarding just the Mesh port asks a non-expert to run an internet-facing
  service at home. This produced a hard rule for phase 8: **Mesh listens on its
  own port, never the API port, and openMemo never opens one itself.**

**Reframe worth keeping:** being away is the normal case, not an error. Changes
accumulate in the change log with HLC ordering, so the MacBook is fully usable
offline and reconciles on reconnect. The requirement is *eventual* reachability,
not constant connectivity.

**New phase 9** splits the security work out from transport: replay protection,
handshake rate limiting, cert pinned at pairing with a loud refusal on change,
and revocation promoted from tidiness to security. On a LAN these were defence
in depth; off it they are load-bearing.

Honest cost recorded in the ADR: an overlay is a third-party account and a
background daemon. That does not break "Mesh needs no account" — the Mesh code
is still its only identity — but it does break "nothing in the middle", so the
walkthrough copy gets revisited in phase 9 rather than being left to overclaim.

### 2026-08-01 — Phase 1 DONE: Mesh flag + Settings section

Phase 0 merged to main (PR #124). Branch reset to main, then phase 1 built.

- `backend/core/mesh.py` — the single gate. `is_enabled()` reads settings on
  every call rather than caching: a stale cache would mean sync quietly
  continuing after the user switched it off, the one outcome worth a file read
  to avoid. `require_enabled()` returns **404, not 403** — a disabled feature
  should be indistinguishable from one that was never built, since 403
  advertises the endpoint and invites probing on a LAN-exposed port.
- `backend/api/mesh.py` — `/api/mesh/status`, entirely behind the gate. `paired`
  is hardcoded `False` so the shape is stable for the UI without pretending to
  know something it cannot yet.
- `mesh_enabled` added to settings defaults, the `SettingsPatch` model, the
  frontend `AppSettings` type, and the fallback profile object.
- Settings → Mesh card, matching the existing `SettingCard` pattern. When on it
  reveals an honest "not ready to pair yet" panel rather than implying sync
  works.

**Review pass 1 found a real bug: settings have TWO allowlists.** `_DEFAULTS` in
`app_settings.py` and the `SettingsPatch` model in `api/settings.py`. A key in
the first but missing from the second is dropped **silently** — the PUT still
returns 200, so the toggle would have appeared to work and changed nothing.
Caught because a test asserted persistence rather than just a 200.
`test_every_setting_default_is_writable_through_the_api` now pins it, and it
immediately surfaced a pre-existing case, `bg_image_ext`, which is legitimately
server-managed by the background-upload route and is documented as exempt.

**Pass 2 (blast radius):** no bugs. `/api/mesh` is a new prefix with no
collision. `mesh_enabled` is a boolean, not a secret, so exposing it through
`GET /api/settings` is fine. Backups cover the DB and files, not
`app_settings.json`, so the flag is unaffected either way. No extension, macOS,
Docker or nginx impact — this adds one gated route.

**Pass 3 (fit):** no bugs. `core/mesh.py` is a module now and becomes a package
when phases 2+ add tables; the import path `backend.core.mesh` stays valid.

**Verified in the running UI**, not just tests: booted against a throwaway
DATA_DIR, loaded Settings, and clicked the real toggle. It went off→on,
persisted through `PUT /api/settings`, flipped `/api/mesh/status` from 404 to
200, and revealed the not-ready panel. Screenshot taken. Card sits correctly in
the bento grid between Phone capture and Made by.

Suite: **119 passed**.

### 2026-08-01 (third review round) — widened to deploy surface, no new bugs

Swept the areas outside the backend entirely, as asked.

| checked | verdict |
|---|---|
| Chrome extension | Clean. Hits one route, `/ingest/extension`, already migrated. Its response shape is unchanged and its `"status": "processing"` is a literal, not derived from job state. |
| macOS wrapper | Clean. `macOS/src/backend.ts` spawns a single uvicorn, no `--workers`. |
| Dockerfile / compose | Clean. Single uvicorn, no `--workers`, no replicas or scale directives. |
| nginx | Unaffected. Response timing did not change — `add_task` already ran after the response — so `proxy_read_timeout` and buffering are untouched. |
| Frontend timing | Clean, and better than expected. The UI treats `pending` and `processing` as the same "working" state (`MemoCard.tsx:143`, `MemoDetail.tsx:1976`), so the ≤2s gap before a worker flips one to the other is invisible. Refetch intervals are 2500–4000ms, comfortably longer than the poll. |

**One latent hazard, now guarded.** The queue assumes **one process per
database**: `reclaim(all_running=True)` requeues everything left `running` at
startup, which is only safe because a job cannot be running if the process was
down. Adding `--workers 4` to the Dockerfile would silently break that — process
B's startup sweep would steal jobs process A is actively running, and the same
download would run twice with no error anywhere.

Both deployments are single-process today, so nothing is wrong. But the failure
is silent and the change that causes it looks completely harmless, so
`test_deployments_stay_single_process` now fails the build if either deployment
gains `--workers`, with the reason and the fix in the assertion message.

Suite: **113 passed**.

### 2026-08-01 (second review round) — 2 more real bugs, found by widening scope

Owner asked for another 3-pass before merging, explicitly covering things not
looked at yet. Two genuine bugs surfaced — both outside the files changed so far,
which is exactly why the wider sweep was worth it.

**Pass 1 — the Telegram relay never got migrated.** `_save_url` collected its
follow-up jobs and ran them itself via `_fire_and_forget`, bypassing the queue
completely. That is the owner's heaviest ingest path (Telegram, ~20 saves/day,
and batch forwards), so the pile-up the queue exists to prevent survived exactly
where it hurts most: a batch of forwarded links started a download per link at
once, and a restart lost all of them. Now hands every job to `queue_task`. Jobs
are still collected during ingest and handed over only after commit, so nothing
is queued for a memo that failed to save. `_fire_and_forget` is now dead and
removed.

**Pass 2 — backup/restore resurrected stale jobs.** `_sqlite_backup` copies the
whole database, `job_queue` included. Restoring therefore reinstated whatever was
queued when the backup was taken, and the startup sweep dutifully requeued it —
re-running downloads for memos that may not exist in the restored library.
`job_queue` is this device's transient to-do list, not user data, so restore now
clears it. Guarded, since a backup predating the queue has no such table.

**Pass 3 — no bugs.** `BackgroundTasks` parameters remain in several route
signatures, unused but harmless (FastAPI still injects them); removing them
widens the diff for no behaviour change. Confirmed the f-string SQL in
`reclaim()` interpolates only a hardcoded literal chosen by a bool, never user
input. No new dependencies — everything used is stdlib or SQLAlchemy.

Two new guard tests: one pins the relay to the queue, one fails if any
`background_tasks.add_task` call site ever reappears in the migrated files.

Suite: **112 passed** across 3 consecutive runs.

**Process note.** A first-round review that only looked at the files I had just
edited missed both of these. Reviewing the blast radius — callers, sibling
services, backup/restore, deploy config — found them immediately. Worth
repeating for every later phase.

### 2026-08-01 — Phase 0 DONE: call sites migrated, ticket queue chosen

Owner picked the **ticket queue** over the turnstile. Open decision closed.

- Added `queue_task(fn, *args)` to `job_handlers.py` — signature-compatible with
  `BackgroundTasks.add_task`, so every call site was a one-word change and no
  function signature moved, including `ingest_url_core`'s injected `schedule`
  callable that the Telegram relay also supplies. Kept **synchronous** on
  purpose: an async shim would have meant awaiting at 27 sites plus changing the
  relay's contract, for no durability gain — what matters starts at the INSERT.
- Routing keys on the function **name**, not the object, because the task
  functions live in `ingest.py` which now imports this module. Avoids a cycle.
- Migrated 27 call sites (ingest 21, memos 5, music 1) plus
  `schedule_processing`, which was the last bare `asyncio.create_task`.
- `backend/tests/test_job_routing.py` (14 tests) pins the arg-shape contract for
  every routed function. That is the real safety net for a mechanical refactor:
  the danger was never a loud failure, it was an argument silently landing in
  the wrong payload slot and exploding later inside a worker.

**Review pass 1 caught a real regression, fixed:** ingest's auto-download path
queues auto-localize *and* an explicit audio/video localize for the same memo.
Both mapped to kind `localize`, and dedupe keys on (kind, memo_id) — so the
explicit job was silently dropped and "make it local" would have quietly stopped
downloading. Split into `localize` and `localize_auto`, with a regression test.

**Pass 2 (data safety):** no new bugs. Two nuances recorded rather than changed:

1. *Dedupe collapses against `running`, not just `queued`.* Edit a memo while its
   embed job is already running and the second request is deduped, so the
   embedding can be one revision stale until the next edit. Not data loss —
   `process_memo` re-reads from the DB — and dropping to queued-only dedupe would
   let an expensive download start twice. Left as is deliberately.
2. *A tiny enqueue window.* `queue_task` schedules the INSERT rather than
   awaiting it, so a process death in that instant loses the request — the same
   window `add_task` always had. Durability starts at the insert.

**Pass 3 (fit):** no bugs. `BackgroundTasks` parameters are now unused on several
routes; harmless (FastAPI still injects them) and removing them would widen the
diff for no behaviour change. Worth a tidy-up pass later.

Suite: **110 passed** across 3 consecutive runs, up from 96.

**Verified in the running app.** Booted the worktree backend on a throwaway
DATA_DIR (never the main DB — this branch adds a table and unmerged migrations
have no business touching real data), then hit `POST /api/memos/{id}/localize`.
The job went `queued → running → done` with the worker picking it up on its own.
Route → shim → queue → worker → completion all confirmed outside the test suite.

Still unverified: the *concurrency cap* under real load. Proving 40 downloads
start 3 at a time needs a real playlist import, which downloads gigabytes.
Worth doing once on a real machine before trusting it for a big import.

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

- **No account.** The 12-word Mesh code *is* the identity (§2).
- **~~No relay.~~ Reversed 2026-08-02** — the MacBook must sync while travelling.
  Resolved *without* openMemo running anything: a user-controlled WireGuard
  overlay carries the same socket. Still no openMemo account, server or ops.
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
