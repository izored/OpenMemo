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
| 0 | Job queue | **No** — plain infra, fixes live bug | TODO | ADR §9 |
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

## Phase log

Newest entry at the top. One entry per working turn.

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
