# Mesh — the complete handbook

**Audience: a reviewer with no prior context.** This is written to be handed to
another model or engineer for an adversarial review of the whole feature. It
records not just what was built, but *why*, what was rejected, what was measured,
what went wrong during construction, and — most importantly — **what is still
unproven**.

Companion documents:

- [`ADR-024-MESH.md`](ADR-024-MESH.md) — the design decisions themselves
- [`../plans/024-mesh-execution.md`](../plans/024-mesh-execution.md) — the
  session-by-session build log, including dead ends

---

## 1. What Mesh is

Two-way sync between a user's own devices — in the original case a Windows/Docker
desktop and a MacBook — so both hold the same openMemo library and both can
write to it.

Constraints set by the owner, in the order they were given:

| # | Constraint | Consequence |
|---|---|---|
| 1 | No online server | Rules out a hosted relay; drove the magnet design |
| 2 | Plug-and-play, "no niche things" | 12 words + QR, not config files |
| 3 | Must work away from home | *Reversed* an earlier "same network only" decision |
| 4 | openMemo itself never goes online | Separate port, separate ASGI app, closed protocol |
| 5 | Only activate when enabled | Triggers created on enable, dropped on disable |
| 6 | Must not bloat openMemo | Enforced coupling budget: 17 lines in core |
| 7 | Structural metadata is priority | Covers ship before media |

---

## 2. The measurement everything rests on

Run `python scripts/blob-split.py` from the repo root. On the owner's real
library, 2026-08-02:

```
RE-DERIVABLE    360 files   23.66 GB   magnet, refetch from source
LOCAL-ONLY       59 files    1.58 GB   must transfer peer to peer
COVERS            2 files    0.01 GB   no source; structural, sent first
DATABASE                    0.0073 GB  the actual sync
must cross the wire: 1.58 GB (5.9% of everything)
```

**94% of the library is a URL wearing a 24 GB costume.** Apple Music (177),
YouTube (113), Instagram (36), Spotify (11). openMemo already knows how to fetch
all of it.

This single fact produced the whole architecture: sync the *recipe*, not the
payload. A reviewer who disagrees with this measurement should re-run the script
before disagreeing with anything downstream.

**Known decay risk:** links die. The 94% will drift down over years. The peer
path must therefore stay a first-class citizen, not a rarely-exercised fallback.

---

## 3. Architecture in one page

```
        ┌────────────── openMemo (unchanged) ──────────────┐
        │  API :8000  ·  unauthenticated by design         │
        │  NEVER exposed to a network                      │
        └──────────────────────────────────────────────────┘
                              │
                  17 lines of coupling, 5 files
                              │
        ┌────────────── backend/core/mesh/ ────────────────┐
        │  _gate      is Mesh on?                          │
        │  clock      hybrid logical clock (in SQL)        │
        │  changelog  triggers → mesh_change_log           │
        │  merge      pure 3-way merge                     │
        │  rowstore   read/write rows + agreed base        │
        │  apply      merge → database, journal, conflicts │
        │  journal    history, snapshots, undo             │
        │  magnet     recipes, covers, fetch policy        │
        │  secret     one root → HKDF → 3 keys             │
        │  protocol   closed message set, auth-then-parse  │
        │  server     SEPARATE ASGI app, port 8770         │
        │  session    the conversation                     │
        │  pairing    12 words, QR, devices, primary role  │
        └──────────────────────────────────────────────────┘
                              │
                    one WebSocket, dialed outward
```

### The two lanes

| Lane | Size | Speed | Contents |
|---|---|---|---|
| Metadata | 7 MB | seconds | rows, transcripts, AI summaries, magnets |
| Blobs | 25 GB | lazy | media, fetched from source or peer |

A memo arrives complete — title, notes, tags, transcript, searchable — long
before its 4 GB video does.

---

## 4. Every significant decision, and what was rejected

### 4.1 Sync the recipe, not the payload

**Chosen.** Each blob gets a magnet: `{blob, bytes, sha256, sources[]}`, where
sources are ordered `provider → origin → peer`.

**Rejected:** copying files between devices. It would make pairing a 24 GB event
and force both machines online simultaneously for hours.

**Non-negotiable rule:** the peer is *always* the last source and *always*
present. A deleted YouTube video must never mean losing media the other machine
still holds. 59 files (1.58 GB) have no other source at all.

**Honest cost:** refetched bytes are *equivalent, not identical*. YouTube
re-encodes; Qobuz may serve a different master. So `sha256` verifies peer
transfers only, never refetches, and `file_path` is per-device state that is
never synced.

### 4.2 Identity is 12 words, not an account

**Chosen.** BIP39 128-bit seed → HKDF → `chain_id`, `psk`, `content_key`.

**Rejected:** an account. There is no server for an account to identify you to.
Comet asks for one because it kept Brave's relay; we dropped the relay.

**Why BIP39 rather than hand-rolled:** a wrong wordlist would be a silent
correctness bug in the one value the user writes on paper and cannot re-derive.
The checksum turns a typo into an immediate error instead of a pairing that
mysteriously never connects.

**Why separate keys:** reusing one key across an authenticator and a cipher is
how protocols grow cross-protocol attacks. One HKDF call avoids ever thinking
about it.

### 4.3 Reachability — three tiers, one socket *(reversed mid-project)*

Originally "same network required". The owner needs the MacBook to sync while
travelling, so this was revised rather than stretched.

| Tier | Mechanism | When |
|---|---|---|
| 1 | mDNS on `hash(chain_id)` | at home, zero config |
| 2 | user-run WireGuard overlay (Tailscale) | on the move |
| 3 | manual address / QR hint | debugging |

The sync layer cannot tell which tier carried it, so **tier 2 needs zero Mesh
code changes**.

**Why it stayed small:** the problem is not symmetric. The desktop never moves
and is always on; only the laptop roams. One side needs to be reachable, and it
is the side that never moves.

**Rejected:** a relay openMemo builds or hosts (ends local-first, adds an outage
surface). **Rejected harder:** port-forwarding — the local API is
*unauthenticated by design*, so forwarding it publishes the entire library.

### 4.4 Isolation — openMemo never goes online

The Mesh listener is **a separate ASGI app with a separate routing table on a
separate port**. Not a route on the application. There is no `/api` to walk to
and no static mount, so a traversal has nowhere to go.

Enforced by tests: nine paths (`/api/memos`, `/openapi.json`, `/`,
`/../../etc/passwd`, …) must 404 and must leak nothing about the app. One test
greps a raw frame for a memo title and fails if it appears. One test asserts the
message set contains no verb naming a path, command or URL.

**Blast radius:** a total compromise of the Mesh listener yields memo rows to
someone who already had to hold the 12-word code — not access to an
unauthenticated local API.

### 4.5 Ordering — hybrid logical clock, in SQL

**Chosen.** `mesh_clock` is a one-row table; triggers advance it **in the same
transaction as the write they record**, so the log's order and the database's
order cannot drift apart.

**Rejected:** wall-clock `updated_at`. Two machines, two drifting clocks — the
laptop running three minutes fast would win every conflict, silently.

**Rejected:** stamping in Python. SQLite triggers cannot call Python, so the app
would have to stamp, and under concurrency the log could disagree with the data.

Format `0001754092800123-000004-a1b2c3d4`, zero-padded so a plain string sort
equals the logical order — in SQL, in Python, and in a log a human is reading.

### 4.6 Merge — three-way, per-tier

**Chosen.** Pure functions taking `(local, remote, base)`. `base` is the row as
it stood when the devices last agreed, stored in `mesh_base`.

**Why three-way:** two-way cannot tell *"you edited the title, I edited the
tags"* from *"we both set the title"*. Both just look different.

| Tier | Fields | Behaviour |
|---|---|---|
| `LOCAL_ONLY` | `file_path`, `thumbnail_path`, `localize_*`, `embed_*` | never crosses the wire |
| `MACHINE` | `content_text`, `ai_summary`, `summaries`, `transcript_*` | never prompts; **absence never beats presence** |
| `HUMAN` | `title`, `description`, `content_raw`, `notes`, `name` | the only tier that can conflict |
| plain | 22 other columns | last-writer-wins |

`summaries` merges **per key**, because generating `essay` on one device and
`insights` on the other would otherwise discard an expensive Ollama run.

Membership is an **OR-set with tombstones** — a plain union cannot express
removal, so untagging would be undone on every sync forever.

**Rejected:** a full CRDT (Automerge/Yjs). It solves multi-user concurrent
editing, which one person with two computers does not have.

### 4.7 Conflicts are parked, never decided

A field both humans edited is stored pending; the local value is untouched; the
rest of the row still applies. Keep-both is the default and preserves the loser
as a linked copy titled `… (from <device>)`.

### 4.8 Nothing is unexplained or permanent

`mesh_journal` records every field Mesh writes with `old_value`, `new_value` and
**`rule`**. Snapshots via sqlite3's backup API before each batch (20 kept ≈ 150
MB). Undo replays a batch backwards.

Two rules: an undo writes a **new** stamp (a fresh edit, not time travel —
otherwise the peer re-applies what was undone), and an undo is **itself
journaled**.

### 4.9 Structure first, covers eagerly

Spaces, collections, playlists, albums, hidden, ordering all sync as rows. But
**covers live in `DATA_DIR/space_covers/` and `playlist_covers/`, outside
`files/`** — the magnet design missed them, and so did the measurement script.

They are the one clean exception: no source to refetch from, small, structural.
A Space without its cover looks broken in a way a track without audio does not.
So they transfer eagerly, ahead of all media.

### 4.10 Fetch policy — 20 recent, then fill in

**Chosen** by the owner over the two extremes. Fetch-on-open makes a new device
feel empty and every first play slow; keeping everything makes pairing a 24 GB
event.

### 4.11 The primary device — real, but not for merges

The desktop is primary because it runs the Telegram bot. It owns:

- **Singleton jobs** — `telegram_relay` polls `getUpdates` with an in-memory
  offset, and Telegram hands each update to whoever asks first, exactly once.
  Two devices polling one token race and lose memos. *Correctness, not
  preference.*
- **Heavy work by default** — Whisper, Ollama.
- **Pairing host.**

It explicitly does **not** win merges. A merge-primary would make the MacBook
unsafe to write to, contradicting "never break any device's content". It gets
the preselected radio button, not the last word.

---

## 5. Invariants a reviewer should try to break

| # | Invariant | Where enforced |
|---|---|---|
| 1 | Disabled Mesh records nothing, listens nowhere, serves nothing | `test_mesh_contract.py` |
| 2 | Merge is symmetric — swapping devices yields identical output | `both_ways()` in `test_mesh_merge.py` |
| 3 | Nothing Mesh writes is unjournaled | `test_nothing_is_applied_without_a_journal_entry` |
| 4 | A conflict never stalls the rest of the row | `test_a_conflict_does_not_stall_the_rest_of_the_row` |
| 5 | The peer is always an available source | `test_the_peer_is_always_present_as_a_last_resort` |
| 6 | The app is unreachable from the Mesh port | 9 parametrised paths |
| 7 | Payloads are unreadable on the wire | grep the raw frame |
| 8 | Only the primary polls Telegram | `test_only_the_primary_polls_telegram` |
| 9 | A busy Mesh port cannot stop the app | `test_a_busy_mesh_port_cannot_take_down_the_app` |
| 10 | Every table/column has a deliberate sync policy | the contract sweep |

---

## 6. Bugs found during construction

Recorded because the *pattern* is instructive, not to pad the document. Every
one was found by review or by running code — none by reading alone.

| # | Bug | Why it mattered | Found by |
|---|---|---|---|
| 1 | `reclaim()` only requeued *expired* leases | Jobs stranded an hour after every restart | correctness pass |
| 2 | DB write awaited inside `except CancelledError` | Would raise from inside the handler | correctness pass |
| 3 | Dedupe was advisory (read-then-insert race) | Duplicate jobs | correctness pass |
| 4 | Payload decoded *after* claiming | Malformed payload looped hourly forever, never counting an attempt | data-safety pass |
| 5 | `LEASE_SECONDS` a hard ceiling on job duration | A long download got requeued **while still running** — same download twice | data-safety pass |
| 6 | Auto-localize and explicit localize shared a kind | Dedupe silently dropped one — **"make it local" would have stopped working** | correctness pass |
| 7 | **Telegram relay bypassed the queue entirely** | The heaviest ingest path kept the exact pile-up the queue existed to fix | blast-radius pass |
| 8 | Backup/restore resurrected stale jobs | Re-ran downloads for memos that may not exist | blast-radius pass |
| 9 | `observe()` ignored the peer's counter in the same millisecond | Could mint a stamp the peer already used | correctness pass |
| 10 | `device_id` travelled inside backups | Restoring onto both machines gives them **one identity** — breaks the tiebreak, misattributes every change | blast-radius pass |
| 11 | **`summaries` union kept whichever side was "local"** | **Silent, permanent divergence with no conflict raised** | symmetry test |
| 12 | Undo interpolated table/column from stored rows | Injection shape | data-safety pass |
| 13 | Sync conversation desynced (ack before changes) | Exchange broke entirely | first real end-to-end run |
| 14 | Cursor could move backwards | Infinite resend loop | correctness pass |
| 15 | Keep-both copy lost its provenance when the field *was* the title | Copy indistinguishable from a normal memo | correctness pass |
| 16 | **A busy Mesh port killed the whole process** | uvicorn calls `sys.exit(1)` from *inside* the serve task, defeating the try/except — and a commit message had already claimed this was safe | running the suite |
| 17 | Failed Undo swallowed silently | User believes a sync was reversed when it was not | blast-radius pass |
| 18 | `WHERE is_deleted = 0` skipped NULL rows | Legacy rows silently excluded from sync | running tests on real data |

**Pattern worth noting:** bugs 7, 8, 10 and 17 were all found by reviewing the
*blast radius* — callers, sibling services, backup, deploy — rather than the
diff. A review that only reads changed files misses this entire class.

---

## 7. What is NOT proven — read this first

Be sceptical here. These are the gaps a reviewer should probe hardest.

### 7.1 Two real machines have never synced

Every test runs both "devices" against **one database in one process**. That
proves the pipeline, the protocol and the merge logic. It does **not** prove two
independent libraries converge.

An early test asserted a journal entry after a memo "crossed" and failed —
correctly, because the peer already held an identical row and rightly wrote
nothing. The test was rewritten to claim only what it proves.

**This is the single biggest untested area.**

### 7.2 The concurrency cap is unproven under real load

Nothing has demonstrated 40 downloads becoming 3. Needs a genuine multi-gigabyte
playlist import.

### 7.3 Workers are disabled in tests

`OPENMEMO_DISABLE_JOB_WORKERS=1` is set by `conftest.py`, because the queue keeps
its worker set in module globals — right for one long-lived process, wrong for a
suite building ~90 event loops. **So no test covers the real startup path with
workers live.** The clean fix is instance scope, not removing the gate.

### 7.4 ~~Encryption is a placeholder~~ — CLOSED in phase 9

Now **AES-256-GCM** from `cryptography`. The frame header (nonce + sequence) is
passed as associated data, so a renumbered frame fails authenticated decryption
rather than relying on a later comparison a refactor could drop.

The PSK HMAC is retained *on top* of GCM, deliberately: it proves the peer holds
the pairing secret before a single AES operation is spent on attacker-chosen
bytes. Decryption failures do not report why.

Still worth a reviewer's attention: the 12-byte GCM nonce is derived by hashing
the 16 random bytes on the wire. Nonce uniqueness is therefore only as good as
the randomness, which is `os.urandom`. A test asserts 200 frames produce 200
distinct nonces, but that is a smoke test rather than a proof.

### 7.5 Windows has no keychain path

`pairing._keychain_set` works on macOS via `security`. On Windows it returns
False and the seed lives in `app_settings.json`. Recorded rather than pretended.

### 7.6 Phases 9 and 10 are not built

Cross-network reachability (overlay support, replay hardening, cert pinning) and
the 10-pass cleanup remain.

---

## 8. Where to look for trouble

Suggested order for an adversarial review:

1. **`merge.py`** — decides whether the user keeps their work. Attack symmetry.
   Bug 11 lived here and passed 26 tests.
2. **`apply.py`** — the only place a peer's data becomes a database write. Check
   every path journals, and that conflicted fields cannot leak through.
3. **`protocol.py`** — authenticate-before-parse ordering; the closed message
   set; whether §7.4's placeholder cipher is acceptable for the threat model.
4. **`changelog.py` triggers** — they run inside app transactions. Look for
   anything that could deadlock or slow a hot write path.
5. **`journal.undo_batch`** — interpolates identifiers into SQL (validated
   against the live schema; verify that validation cannot be bypassed).
6. **The contract sweep** — is the coupling budget honest, or has it become a
   registry that gets extended rather than a limit?

Useful commands:

```bash
python -m pytest backend/tests/ -q -o asyncio_mode=auto   # 286 tests
python scripts/blob-split.py                              # re-measure the library
grep -rn "mesh" backend/ --include=*.py | grep -v core/mesh | grep -v tests
```

---

## 9. Build order and status

| Phase | What | Status |
|---|---|---|
| 0 | Job queue (**not** Mesh-gated — fixed a live bug) | merged |
| 1 | Feature flag, Settings card, walkthrough | merged |
| 2 | Change log, triggers, hybrid logical clock | merged |
| 3 | Merge engine | merged |
| 4 | Journal, snapshots, rollback | merged |
| 5 | Isolated port, protocol, row exchange | merged |
| 6 | Conflict dialogue, history, undo | merged |
| 7 | Magnets, covers, fetch policy | merged |
| 8 | Mesh code, QR, devices, primary role | done |
| 9 | AES-GCM, revocation enforcement, handshake throttling | done |
| 10 | Ten-pass cleanup | not started |

**Phase 0 shipped first and is deliberately not gated.** There were 25
fire-and-forget background tasks with no concurrency cap, no persistence and no
retry: importing 40 memos started 40 downloads at once, and a restart lost them
all. Mesh would have multiplied that into data loss.

---

## 10. Questions worth asking of this design

Offered honestly, because a reviewer should not have to find them from scratch:

1. Is a three-way merge with a stored base worth the `mesh_base` table, versus
   accepting more conflicts with two-way?
2. Is "absence never beats presence" for `MACHINE` fields ever wrong — is there
   a legitimate reason to *clear* a transcript?
3. `merge_link` uses the base's `__hlc` as the local timestamp. Is that accurate
   enough for rapid add/remove cycles?
4. The change log grows unbounded. `mesh_journal` is pruned; should the change
   log be too, and what breaks if a peer's cursor falls off the end?
5. Is 20 the right eager-fetch window, or should it be size-based rather than
   count-based? Twenty 4K videos is very different from twenty notes.
6. `apply_rows` calls `clock.observe()` with the maximum stamp *after* applying.
   Should it observe before, in case applying takes a long time?
7. Is the coupling budget (17 lines, 6 files) actually holding, or is it drifting
   upward one justified exception at a time?
