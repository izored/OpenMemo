# ADR-024: Mesh — your devices hold one library, with no server in the middle

**Date:** 2026-07-31 · **Status:** In progress · **Builds on:** ADR-020 (Spaces isolation), ADR-005 (audio sub-kinds), ADR-015 (playlist-born tracks)

## Context

A MacBook running the packaged app and a Windows box running Docker each hold
their own library. Today the only way to move work between them is
backup/restore, which overwrites one side wholesale — it is a migration tool,
not a sync tool.

**Mesh** is the feature name. Both devices can write. No account, no cloud, no
relay. Turn it on once, never think about it again.

Two things this ADR refuses, and both are refusals of *silence*: no rule
overwrites human work without asking (§7), and no sync writes a row that is not
logged and reversible (§13). Everything else is negotiable.

Two constraints shape everything below, and both were measured rather than
assumed:

- **§9 is a prerequisite that ships first.** The job queue does not exist today,
  and Mesh would multiply its absence into data loss. It is not Mesh code and it
  is not gated (§0) — it fixes a live bug on its own.
- **94% of the library is refetchable** (§1). That single measurement is why
  Mesh moves 7 MB instead of 25 GB.

## Decision

---

## 0. Mesh is one feature flag, off by default

Every table, trigger, worker, socket and route in this ADR is inert until the
user turns Mesh on in Settings → Mesh. That is a hard requirement, not a
courtesy: an unused feature must cost an existing install exactly nothing.

```
mesh_enabled          default: false      # app_settings.json
```

What "off" means, precisely:

| when disabled | state |
|---|---|
| `mesh_change_log`, `mesh_journal`, `mesh_devices` tables | exist (empty), created by migration |
| Triggers on `memos`, `collections`, `tags`, … | **dropped** — zero write overhead |
| Sync worker, WebSocket listener, mDNS advertiser | never started |
| `/api/mesh/*` routes | return 404 |
| Seed in the OS keychain | absent |

Triggers are created on enable and dropped on disable rather than gated with a
`WHEN` clause, so a user who never touches Mesh pays no per-write cost at all.
Enabling is idempotent; disabling leaves the tables and their history intact so
re-enabling is not a fresh start.

**The one exception is §9, the job queue.** It is ordinary app infrastructure
that fixes an existing bug, it is not behind `mesh_enabled`, and Mesh merely
becomes another producer of jobs once enabled.

Settings → Mesh, when off, is a single explanatory panel and one toggle. Every
sub-setting in this ADR (`auto_transcribe_on_sync`, storage policy, device list,
history) appears only after it is on.

---

## 1. Sync the recipe, not the payload

Measured on the live library (`scripts/blob-split.py`):

| | files | size | how the other device gets it |
|---|---|---|---|
| **Re-derivable** — has `source_url` | 360 | **23.66 GB** | refetches it itself |
| **Local-only** — no source | 59 | **1.58 GB** | must cross the wire |
| Thumbs | 641 | 0.07 GB | regenerate locally |
| Chroma + hf-cache | — | 0.49 GB | never synced, rebuilt |
| `openmemo.db` | 1 | **7.3 MB** | the actual sync |

**94% of the library is a URL wearing a 24 GB costume.** Apple Music (177),
YouTube (113), Instagram (36), Spotify (11) — the bytes already exist on the
internet and OpenMemo already knows how to fetch them. `localize_media.py`,
`spotiflac.py`, `instagram.py` do it every day, and `auto_download_audio` /
`auto_download_video` already ship in settings.

So do not ship files between devices. Ship the **magnet**: a text record naming
the blob and every way to obtain it. The receiving device resolves it with the
downloader it already has.

```json
{
  "blob":   "007c0743-ea11-4b64-8eee-c644395f7495.flac",
  "bytes":  41234567,
  "sha256": "9f2c…",
  "sources": [
    { "kind": "qobuz",  "url": "…", "quality": "24" },
    { "kind": "origin", "url": "https://music.apple.com/…" },
    { "kind": "peer",   "device": "IZORED-ADMIN" }
  ]
}
```

The peer is **just another source in the list, ranked last**. No separate
transfer subsystem, no special case — one resolver, one queue, sources tried in
order. That single decision is what makes the whole thing small.

### Peer is the backstop, and that is non-negotiable

Refetch fails permanently and often: video pulled from YouTube, Instagram post
deleted, region lock, login gate. The `localize_error` column exists precisely
because this already happens.

If refetch were the only path, a dead source would mean **losing media you still
have on the other machine**. So when every internet source fails, the resolver
falls through to the peer. Magnet-first, peer-as-backstop. The 1.58 GB of
local-only blobs take that path from the start, since they have no other.

### What this buys

- **No first sync.** Metadata is 7 MB. Both libraries look complete in seconds,
  not two hours. There is no 25 GB event to explain to the user, ever.
- **Lazy.** Fetch what gets opened. A MacBook that plays 40 tracks pulls 2 GB,
  not 25.
- **Devices need not overlap.** Refetching from Qobuz does not require the
  Windows box to be awake, on the same Wi-Fi, or online at all.
- **Per-device quality.** Desktop keeps 24-bit FLAC, laptop keeps 320 kbps, same
  library. Impossible with byte-copy sync, natural with magnets — `music_quality`
  becomes a local policy instead of a synced value.

### The honest cost

**Refetched bytes are equivalent, not identical.** YouTube re-encodes, Qobuz may
serve a different master, CDNs rotate. So:

- `sha256` verifies **peer transfers and dedupe**. It is not a contract that a
  refetch will match, and the code must never treat a mismatch there as
  corruption.
- Extensions can differ across devices (`.m4a` vs `.opus`), so `file_path` is
  per-device state and **must not be synced as authoritative** — the memo row
  carries the magnet, each device records where its own copy landed.
- Derived data survives: transcripts, waveforms and summaries live in the DB and
  sync as metadata, so a refetched file does not cost re-transcription.

### What still merges

The 7.3 MB database. That is the entire conflict surface, and everything below
this section is about it.

---

## 2. Identity — a Mesh code, never an account

**No account. No email. No login.** The Mesh code *is* the identity. This is the
Brave Sync model that Comet ships, and it is the right one here.

First device generates 128 bits of entropy → BIP39 → **12 words**:

```
harbor  velvet  cactus  ridge  ember  quilt
lantern  drift  marble  oyster  thistle  vault
```

That seed is the root of everything, via HKDF:

| derived | used for |
|---|---|
| `chain_id` = HKDF(seed, "chain") | which library this is. Broadcast as a **hash**, never raw. |
| `psk` = HKDF(seed, "psk") | authenticates the handshake, pins the TLS cert. |
| `key` = HKDF(seed, "content") | encrypts every frame on the wire. |

Two devices holding the same 12 words are the same library. Nothing else is
consulted, because there is nothing else. No server issues it, no server can
revoke it, no server ever sees it.

**Where it differs from Comet/Brave:** they still bounce encrypted records
through a relay (`sync-v2.brave.com`) — the server cannot read your data, but it
exists, and Comet layered an account on top of it. We drop the relay entirely.
The code stays; the server does not.

### Losing the relay costs us rendezvous — mDNS buys it back

A relay is how Brave devices find each other across networks. Without one,
devices must find each other on the LAN. mDNS/Bonjour, service
`_openmemo._tcp.local`, TXT record carrying device name + `hash(chain_id)`.

Two machines advertising the same chain hash recognize each other and connect —
**automatically, forever, on any network they share.** The words are typed once,
at pairing. Never again. That is the plug-and-play part.

Consequence to state plainly: **same network required.** Mac at a café and PC at
home do not sync until they meet. Queue changes, sync on reunion, say so in the
status pill. Do not fake it.

### QR is the fast path

QR encodes the words plus a location hint so the first connect is instant
instead of waiting on multicast:

```
openmemo://sync?c=<seed-b64>&h=192.168.1.42&p=8099
```

The host/port is a hint only — it goes stale the moment DHCP reshuffles, and
mDNS takes over from then on. Typing 12 words does the identical thing.

### Transport — one WebSocket, dialed outward

**Docker on Windows cannot do mDNS.** Bridge networking blocks multicast, and
`network_mode: host` does not exist on Docker Desktop. So the design never
requires the Windows side to be discoverable:

- Mac (native app) **advertises**.
- Windows (Docker) **dials out** — outbound connections from a container to the
  LAN work fine.
- Once open, a single long-lived WebSocket carries traffic **both directions**.
  Who dialed is irrelevant after the handshake.

Same trick handles firewalls, NAT and the Windows Firewall inbound prompt: only
one side ever needs to listen.

### The seed is the library

Anyone holding those 12 words has the whole library. So:

- Show the code **once**, blurred until the user clicks reveal (exactly the
  screenshot's pattern), with copy and QR buttons.
- Never write it to logs, never put it in a URL bar, never sync it.
- Store it in the OS keychain — macOS Keychain, Windows Credential Manager — not
  in `app_settings.json`.
- Copy next to it: *anyone with this code can read your whole library.*

### More than two devices comes free

The chain is a set, not a pair. A third device joins with the same words. Merge
is HLC last-writer-wins, which converges under pairwise gossip, so devices do
not all need to be online at once.

A synced `devices` table drives the management list:

```
devices(id, name, platform, last_seen_hlc, revoked)
```

- **Remove a device** — flip `revoked`, it propagates, peers refuse its
  handshake. Manageable from any device, same as the screenshot.
- **Leave sync** — this device wipes its seed from the keychain, keeps its data.
- **Delete sync** — revoke every device. Each drops the chain on next contact.
  Data stays local everywhere; only the link dies.

Revocation is best-effort by nature: a device that never reconnects never learns
it was kicked, and it still holds the seed. Rotating the chain means generating
a new code and re-pairing. Say that in the confirm dialog rather than implying a
remote wipe we cannot perform.

---

## 3. Device roles — what "primary" is allowed to mean

There is a primary. `IZORED-ADMIN` (Windows/Docker) is it, because that is where
the Telegram bot lives and where memos arrive twenty times a day.

But "primary" is three different things, and two of them are correct while the
third would quietly destroy work. Naming them separately is the whole point of
this section.

### Primary owns singleton jobs — required, not optional

`telegram_relay.py` polls `getUpdates` with an in-memory `_offset` (line 61).
Telegram hands each update to **whoever asks first**, exactly once. Two devices
polling the same bot token would race: memos land on a random machine, and
because each keeps its own offset, updates get consumed and dropped.

So Telegram polling **must** run on exactly one device. Not a preference — a
correctness requirement, and one that exists today the moment a second install
appears. The `primary` flag is what enforces it.

Same flag, same reason, for anything else that must not run twice: the
reclassify job (`main.py:217`), scheduled maintenance, playlist re-sync.

### Primary is the default home for heavy work — a good default

The Windows box is always on, plugged in, and running Docker. The MacBook is on
battery. So the primary defaults to owning Whisper, Ollama summaries, and bulk
downloads, while the laptop defaults to fetch-on-open.

A per-device policy, defaulting from role, overridable by the user. The laptop
can still transcribe when asked — it just does not volunteer.

### Primary hosts pairing — cosmetic, but matches expectation

It generates the Mesh code and shows the device list, like the Comet screenshot.
Any device *can* do this; the primary is simply the one that did it first.

### Primary does NOT win merges

This is the one to refuse, and the refusal protects the exact thing asked for in
the same breath: *never break any device's content.*

If Windows always wins, then editing a note on the MacBook is unsafe — the next
sync silently reverts it, and the user learns not to trust the laptop. A library
you can only really write to from one machine is not synced, it is backed up.

The rule stays: **merge is symmetric, always.** What the primary flag earns is
the right to be the **preselected option** in the verification dialogue (§7).
The user who wants to trust Windows clicks through in one keystroke — but it is
a keystroke, and nothing vanishes without it.

| concern | primary | both |
|---|---|---|
| Telegram polling, cron jobs | ✅ exclusive | — |
| Whisper / Ollama by default | ✅ default | overridable |
| Generates Mesh code | ✅ | any device can |
| Ingest, edit, delete | — | ✅ symmetric |
| Merge authority | ❌ never | ✅ symmetric |
| Preselected in conflict dialog | ✅ | — |

Role lives in the synced `devices` table and can be handed over. If the primary
dies, promoting the MacBook is one click and Telegram resumes there — there is
no re-pairing and no data migration, because nothing about the data depended on
which device held the flag.

---

## 4. Change tracking — SQLite triggers, not `updated_at`

Only `Memo` has `updated_at`. `Collection`, `Tag`, `Workspace`, `ChatSession`
have none, and only `Memo` has a soft delete. Delete a collection on the Mac and
a naive scan-based sync resurrects it from Windows. Zombie collections.

Fix without touching a single API route: **triggers into one change log.**

```sql
CREATE TABLE change_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl       TEXT NOT NULL,
  row_id    TEXT NOT NULL,
  op        TEXT NOT NULL,        -- insert | update | delete
  hlc       TEXT NOT NULL,        -- see §4
  device_id TEXT NOT NULL
);
```

AFTER INSERT/UPDATE/DELETE triggers on every synced table. Benefits:

- Deletes become real tombstones for tables that hard-delete today.
- Catches writes from **every** path — API, migration scripts, manual sqlite3.
- Sync cursor is one integer per peer. No table scans.
- Zero changes to `memo_service.py` or any route.

Association tables (`memo_collections`, `memo_tags`) get the same treatment, so
"untag on Mac" survives a round trip instead of being re-added by Windows.

Not synced — all of it is per-device materialization state: `change_log` itself,
`file_path`, `thumbnail_path`, `localize_status`, `localize_error`,
`embedding_ids`, `embed_status`, Chroma, thumbs, hf-cache.

---

## 5. Ordering — hybrid logical clock, not wall clock

Two machines, two clocks, drift. `datetime.utcnow()` last-writer-wins picks the
winner by whichever laptop's clock is fast. Silent data loss.

One `hlc` string column, format `<millis>-<counter>-<device_id>`:

- Ticks forward with wall time when wall time moves.
- Ticks the counter when it does not.
- On receiving a remote HLC, jumps ahead of it.

Result: a total order that never goes backward, needs no coordination, and stays
human-readable when debugging. ~30 lines. This is the standard solution for
exactly this problem, not an exotic one.

---

## 6. Merge — per-row LWW, conflicts kept as copies

Rejected: full CRDT (Automerge/Yjs). Enormous change, and it solves multi-user
concurrent editing — a problem that does not exist here. One human, two
computers, rarely editing the same memo in the same minute.

Chosen:

- **Rows** (memo, collection, workspace, chat): last writer wins by HLC. UUID
  primary keys mean no ID collisions, ever.
- **Sets** (tags, collection membership): add/remove tombstones with HLC, so a
  removal beats an older add and does not get resurrected.
- **True conflict** — both sides edited the same memo's body since last sync:
  **keep both.** Loser becomes a new memo titled `Note (from MacBook)`, linked
  to the winner. Dropbox behavior. Every person alive already understands it.
  Never silently discard something the user typed.

Conflicts should be rare enough to be an event, not a workflow.

---

## 7. The verification dialogue — one dialog, every type

The macOS/Windows "an item named X already exists" prompt works because it does
four things: names both items, shows what distinguishes them, offers a *keep
both* escape hatch, and can be applied to the whole batch. None of that is
file-specific. Generalize it.

**One dialogue for every memo and data type.** It is driven by a field-level
diff, not by per-type UI, so a note, a playlist, a Space cover and a voice memo
all render through the same component.

```
  Both devices changed this memo since they last synced

  Kendrick Lamar — Wesley's Theory
                                                  ┌ recommended ┐
                   IZORED-ADMIN  (primary)        │ Redas-MacBook │
  Notes            "check the bassline at 2:14"   │ "the bass here is insane"
  Tags             funk, sampling                 │ funk
  Transcript       —                              │ 12,847 words · Whisper
  Changed          2 hours ago                    │ 18 minutes ago

   ( ) Keep IZORED-ADMIN     ( ) Keep MacBook     (•) Keep both

   [x] Do the same for the other 6 conflicts        [ Review each ]
```

### The dialogue must be rare, or it is a failure

If this appears often, the merge rules are wrong. Three tiers decide whether it
opens at all:

| tier | fields | behavior |
|---|---|---|
| **Machine-generated** | transcript, summaries, embeddings, thumbnail, `file_path`, `sort_order` | never prompts — union or non-null-wins (§10) |
| **Disjoint human edits** | Mac changed notes, PC changed tags | never prompts — both applied |
| **Same human field, both sides** | `notes`, `title`, `content_raw`, `description` | prompts |

The middle tier is what kills most would-be conflicts: field-level merge means
two people working on different parts of the same memo never collide. Only a
genuine head-on overwrite of the same human-authored text reaches the user.

### Rules the dialogue obeys

- **Keep both is preselected.** The safe option is the default, always. It
  creates a conflict copy titled `Note (from MacBook)` linked to the original.
- **Primary is listed first** and is the one-keystroke choice, per §3.
- **Never silent, never blocking.** Conflicts queue as a badge; the library stays
  usable and nothing is applied until the user decides. A pending conflict does
  not stall the rest of the sync.
- **Batch by default.** Forty conflicts from a mass import is one decision with
  an opt-out into per-item review, not forty modals.
- **Show the value, not the field name.** `"the bass here is insane"` tells the
  user what they are choosing. `notes: modified` does not.
- **Deletes prompt too.** Deleted on one device, edited on the other, is the
  classic silent-loss case. It asks.

Everything the dialogue does is also written to the journal (§13), so a wrong
click is recoverable.

---

## 8. The resolver — one queue, sources in order

A memo whose magnet has no local file is **pending**. The resolver walks its
`sources` in order and stops at the first that works:

1. **Provider** (`qobuz` via `spotiflac.py`) — best quality, honours the local
   `music_quality` policy.
2. **Origin** (`localize_media.py` / yt-dlp, `instagram.py`) — the source URL the
   memo was ingested from.
3. **Peer** — the other device, over the sync socket, HTTP Range, resumable.
   Reached when the internet paths fail, and taken immediately for the 59
   local-only blobs that have nowhere else to come from.

Every step already exists in the codebase. The only new source is step 3, and it
plugs into the same queue rather than beside it.

Scheduling:

- **On demand wins.** Clicking play jumps that blob to the front. Everything
  else is background.
- Then pinned, then recently opened, then the rest — or nothing at all, if the
  user sets fetch-on-open only.
- Cap concurrency, pause on battery, pause on metered Wi-Fi.
- Skip `thumbs/` entirely — regenerating from a local file beats transferring.

Failure is a state, not an error toast: `localize_error` already stores the
reason, and the memo shows *unavailable — login required* rather than a broken
player. A memo with a dead source and a reachable peer is never unavailable.

**Paths are per-device.** `file_path` holds `D:\…\files\…` on Windows and
`/app/files/…` in Docker, and after a refetch the extension itself may differ.
It is never synced. The magnet travels; where each device put its copy is its
own business, resolved locally through `resolve_memo_path()`.

---

## 9. The job queue — the foundation, and it does not exist yet

**There is no queue today.** Twenty-five `background_tasks.add_task` call sites
across `ingest.py`, `memos.py` and `music.py`, plus bare `asyncio.create_task` in
`main.py` and `telegram_relay.py`. No bounded concurrency anywhere, no
persistence, no retry. The only throttle in the codebase is a lock in
`transcribe.py:18`, and it exists because Whisper crashes without it.

Consequences that already bite, before any sync:

- Import 40 memos and 40 yt-dlp processes start at once. CPU, disk and network
  all saturate; downloads fail on timeouts that would have succeeded serially.
- Restart mid-import and every pending task vanishes silently. Memos sit at
  `pending` or `processing` forever with nothing scheduled to finish them.
- A failed download never retries.

Sync multiplies this. Forty memos imported on Windows become forty resolve jobs
on the MacBook, arriving in one burst, on battery. **Building sync on top of
fire-and-forget would turn a rough edge into data loss**, so the queue lands
first.

### A real queue, in the database

```sql
CREATE TABLE job_queue (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,   -- resolve|transcribe|embed|thumbnail|localize|summarize
  memo_id     TEXT,
  priority    INTEGER NOT NULL,
  state       TEXT NOT NULL,   -- queued|running|done|failed|paused
  attempts    INTEGER DEFAULT 0,
  last_error  TEXT,
  lease_until DATETIME,        -- crash recovery: expired lease requeues
  created_at  DATETIME,
  updated_at  DATETIME
);
```

- **Persistent.** Survives restart. A crash mid-job expires its lease and the job
  returns to `queued` instead of disappearing.
- **Bounded per kind.** Network 3, Whisper 1 (it already needs the lock), embed 1,
  thumbnails 4. Tuned per device, not global.
- **Prioritized.** User clicked play = 0. Pinned = 10. Recently opened = 20.
  Background backfill = 100. On-demand always jumps a 500-item backfill.
- **Retry with backoff**, capped, then `failed` with the reason preserved — which
  is what `localize_error` already stores by hand.
- **Not synced.** It is per-device work. Already in the not-synced list (§4).

The resolver (§8) does not get its own machinery — it enqueues `kind=resolve`
and the same workers drain it. One queue for downloads, transcription, embedding
and thumbnails, so they compete for the machine under one policy instead of
fighting.

### What the user sees

A single Activity view: what is running, what is waiting, what failed and why,
with pause and retry. Today, forty simultaneous downloads are invisible until
they fail. This is also the surface for *"getting 6 tracks"* in the status pill
(§14).

Migrating the 25 call sites is mechanical — `add_task(fn, id)` becomes
`enqueue(kind, id)` — but it touches most of the ingest path, so it ships and
gets verified on its own, before any Mesh code exists.

---

## 10. Expensive AI work travels, it is never regenerated

A magnet can rebuild a FLAC. It cannot rebuild the twenty minutes of Whisper
that produced its transcript, or the Ollama pass that wrote its summary. That
work is the actual value in the library, and it must arrive as **data**.

It already does. Every one of these is a DB column, so it rides the 7 MB
metadata lane for free:

| column | what it holds |
|---|---|
| `content_text` | the Whisper transcript / extracted article body |
| `transcript_status` · `_lang` · `_source` | how it was obtained |
| `ai_summary` | the generated summary |
| `summaries` | on-demand summaries keyed by mode |
| `video_description` | original platform description |
| `notes` · `title` · `description` | the human's own work |

So the second device never re-runs Whisper and never re-runs Ollama. It receives
a finished transcript in seconds, and the audio file itself becomes optional —
needed only to *play*, not to search, read, or ask about.

That inverts the usual worry: the cheap-to-move thing is the valuable thing.

### Two carve-outs from plain row LWW

Per-row last-writer-wins is wrong for exactly two of these, and both would
silently destroy work:

**`summaries` merges per key.** It is a dict keyed by mode. Generate `essay` on
the Mac and `insights` on the PC and row-LWW keeps one dict and drops the other
— an expensive Ollama run deleted by a clock comparison. Union the keys, LWW
within each key.

**Null never beats non-null** for `content_text`, `ai_summary`, `summaries` and
`transcript_*`. A device that has not transcribed yet must not overwrite a peer
that has, just because it touched the row more recently. Absence is not an edit.

These are the only two exceptions in the design. Everywhere else, plain LWW.

### Auto-transcribe is off on the sync path

Two separate rules, and the first is not a setting:

**Never auto-transcribe a memo that arrived with a transcript.** If
`transcript_status = 'done'` came over sync, running Whisper again is not merely
a wasted hour — it produces a *different* transcript from a *refetched* file and
tries to overwrite good text with it. The non-null rule above would block the
worst of it, but the job should never be queued in the first place.

**When neither device has transcribed, ask first.** New setting:

```
auto_transcribe_on_sync   default: off
```

Off means a synced audio memo without a transcript stays untranscribed until the
user asks, or until the primary picks it up under its heavy-work default (§3).
Off is the right default because the alternative is a MacBook that joins a sync,
inherits 319 audio memos, and immediately burns its battery re-deriving work the
desktop should own.

Note that upload already defaults to off — `transcribe: bool = Form(default=False)`
in `ingest.py:1373`. This extends the same stance to the sync path rather than
inventing a new one.

### Both directions, always

A primary exists, and it owns real work — Telegram, cron jobs, heavy AI by
default (§3). **None of that reaches the merge.** Mac→PC and PC→Mac run the same
code path: same triggers, same HLC, same merge, same resolver, same carve-outs
above. Either device can be the one that transcribed, summarized, tagged, or
holds the only surviving copy of a blob, and the other pulls from it.

Two asymmetries exist and both sit below the sync layer, where no merge rule can
consult them: who dials the WebSocket (Docker's lack of multicast, §2) and who
holds the primary flag (§3).

Test that as an invariant, not a hope: every sync test runs twice with the roles
swapped — including swapping which device is primary — and all runs must reach
byte-identical merged state.

---

## 11. Chroma — do not sync, re-embed

Chroma's store is a SQLite file plus index blobs. Not mergeable, and
`embedding_ids` are meaningless in another instance's collection.

Treat the vector store as a **local derived cache**. Enqueue embed for memos
whose local `embed_status` is null. Costs Ollama time on the receiving machine;
costs nothing in transfer and cannot corrupt.

Most memos embed straight from synced metadata — `content_text` carries the
article body and the Whisper transcript, so no blob is needed. Only memos whose
transcript has never been generated wait on a resolve.

Trade-off worth naming: on a fresh second device, Ask Memo is degraded until
embedding catches up. Surface that as a progress row, not a silent gap.

---

## 12. Settings — explicit allowlist

`data/app_settings.json` currently mixes three unrelated things:

- **Sync these:** `display_name`, `avatar_data_url`, `num_ctx`.
- **Never sync — secrets:** `telegram_bot_token`, `hidden_passcode_hash`,
  `telegram_allowed_user_id`.
- **Never sync — machine-local:** `chat_model` (different hardware runs
  different models), `max_upload_mb`, `bg_image_ext`.
- **Never sync — fetch policy, now load-bearing:** `music_quality`,
  `music_provider`, `auto_download_audio`, `auto_download_video`. These were
  going to sync until §1 made them the per-device quality policy. A desktop that
  hoards 24-bit and a laptop that keeps 320 kbps are the same library.

Allowlist, not blocklist. A new field defaults to not-synced.

---

## 13. Journal, snapshots, rollback

Sync is the first feature that writes to the database on the user's behalf,
based on data from another machine. It gets a paper trail.

### Every merge decision is logged

```sql
CREATE TABLE sync_journal (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id   TEXT NOT NULL,     -- one sync session
  ts         DATETIME NOT NULL,
  peer       TEXT NOT NULL,
  tbl        TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,              -- what makes rollback possible
  new_value  TEXT,
  rule       TEXT NOT NULL      -- lww|union|non-null|user-choice|conflict-copy|delete
);
```

`rule` is the important column. When something looks wrong, the question is
never "what changed" but "why did it change" — and the answer is one query,
not an afternoon of reasoning about clocks.

Retention by age and size, capped. It is text against a 7 MB database.

### Snapshot before every batch

`backup.py` already has `_sqlite_backup()`, and the database is 7.3 MB. Snapshot
before each sync session, keep the last 20. That is 150 MB for a full undo
history — nothing against a 25 GB library.

This is the actual safety net. Journal rollback is precise; the snapshot is what
saves you when the journal itself is what got it wrong.

### Rollback is metadata-only, and that is a feature

Undo a sync batch by replaying its journal backwards, restoring `old_value` per
field. Content is not rolled back and does not need to be — a magnet (§1)
re-pulls it. **The recipe design is what makes rollback cheap**: there is no 25 GB
of history to keep, because history is 7 MB of text and the bytes are
reproducible.

Two rules that keep it from making things worse:

- **Rollback writes a new HLC.** It is a fresh edit, not time travel. Otherwise
  the peer sees a stale value and helpfully re-applies exactly what was undone.
- **Rollback is itself journaled**, so undoing an undo works.

In the UI: Settings → Sync → History. A list of batches — *"14 changes from
Redas-MacBook, 6 minutes ago"* — expandable to the field level, each with
**Undo**. Not a debug panel; the thing you reach for when a memo looks wrong and
you want to know what touched it.

---

## 14. What the user actually sees

Settings → **Sync**. Empty state, two buttons, no third option:

```
        Start sync              Join a sync
   this is my first device    I have a Mesh code
```

**Start sync** → generates the words, shows them blurred with reveal, copy and
QR. **Join a sync** → one field, 12 words, autocompletes from the BIP39 list and
validates the checksum as you type, so a typo is caught before it becomes
"nothing happens." Or hit scan and point at the other screen.

That is the entire setup. No direction picker, no push/pull buttons, no
profiles, no modes. Two-way always, because anything else is a decision the user
has to make repeatedly and get wrong.

After pairing, the pane becomes the device list from the reference screenshot —
name, last active, remove — plus the Mesh code behind a reveal, and leave/delete.

**There is no first-sync screen.** Seven megabytes land in seconds and the
library is simply there — every memo, note, tag, transcript and cover. Nothing
to explain, nothing to wait for, no progress bar the user has to babysit. That
is the payoff for §1 and it should feel like nothing happened.

Sidebar status pill, one line:

| state | copy |
|---|---|
| idle | `Synced 2 min ago` |
| resolving | `Getting 6 tracks` |
| peer away | `MacBook offline — will sync when it's back` |
| different network | `Waiting for MacBook — not on this network` |
| conflict | `1 conflict — both copies kept` |

Per-memo, a card with no local file is not an error. It shows a small cloud
glyph; clicking play starts the fetch and the button becomes a progress ring.
Same gesture as playing anything else — the fetch is an implementation detail
the user never has to learn a word for.

One preference, in Sync settings, three options:

```
  ( ) Keep everything on this device        24 GB
  (•) Keep what I open                       recommended
  ( ) Keep music only                        18 GB
```

Storage per device is now a **choice**, not a consequence.

The dead-source case is the only one that needs real copy, and it must not lie:

> **Unavailable** — the original was removed from YouTube, and IZORED-ADMIN is
> offline. It will come back when that device is on.

If neither device can ever produce it, say that too. A library that quietly
shows an empty player is worse than one that admits what happened.

---

## 15. Build order

Live status lives in [`plans/024-mesh-execution.md`](../plans/024-mesh-execution.md).
That tracker is the source of truth for what has shipped; this list is the
source of truth for the order.

| # | Phase | Gated | Why here |
|---|---|---|---|
| **0** | Job queue (§9) | **no** | Fixes a live bug on its own. Everything downstream assumes it. |
| **1** | Mesh flag + Settings section (§0) | is the flag | Exists before anything that must be gated by it. |
| **2** | `change_log` + triggers + HLC (§4, §5) | yes | Inert. Verify the log fills correctly under real use. |
| **3** | Merge engine (§6, §10) | inert lib | Pure functions over a two-device simulation, offline. |
| **4** | Journal + snapshot + rollback (§13) | yes | Lands *before* the first real sync writes a row. |
| **5** | Transport + protocol (§2, §14) | yes | Manual address, metadata only. Shippable product. |
| **6** | Verification dialogue (§7) | yes | |
| **7** | Magnets + resolver (§1, §8) | yes | Enqueues into the phase-0 queue. |
| **8** | Mesh code, discovery, pairing, roles (§2, §3) | yes | Plug-and-play on top of a working system. |

Phases 0–4 are the foundation and the ones that must be right. **Nothing before
phase 5 touches the user's data on another machine's say-so**, and by the end of
phase 4 every write that ever will is logged and reversible.

Every phase ends with a **3-pass review** — correctness, then data safety, then
fit and simplicity — with findings fixed between passes. A phase is not done
until all three have run. The tracker records the outcome of each.

---

## Rejected

- **Ship the whole `.db` file.** That is backup/restore, which overwrites the
  peer. Destroys the other device's work by design.
- **Cloud drive as dumb transport** (iCloud/Dropbox folder). 25 GB of paid
  storage, and it is an online server wearing a folder costume.
- **Full CRDT.** Solves a problem this app does not have, at a cost this app
  cannot absorb.
- **Copying 25 GB between devices.** 94% of it is refetchable and the rest is
  lazy. Measured, not assumed — see §1.
- **Regenerating transcripts and summaries on the second device.** Hours of
  Whisper and Ollama to reproduce text that fits in the 7 MB that already synced.
- **A primary that wins merges.** The role is real and owns Telegram, cron and
  heavy AI (§3) — but the moment one machine is "the real one" for *data*, the
  other stops being trustworthy to work on. It gets the preselected radio
  button, not the last word.
- **Building sync before the job queue.** Forty memos already spawn forty
  concurrent downloads and lose them all on restart (§9). Sync would double it.
- **Silent conflict resolution.** Any rule clever enough to never ask is clever
  enough to be wrong without telling you. Ask rarely, but ask (§7).
- **Requiring both sides discoverable.** Breaks on Docker Desktop, which is half
  the deployment.
- **An account.** Nothing needs it. An account exists to tell a server who you
  are, and there is no server. Comet asks for one because it kept Brave's relay;
  we did not.
- **A relay, even an encrypted one.** It is the single thing that would let this
  work across networks, and it is the single thing the user ruled out. Worth
  revisiting only as an explicit opt-in later, never as the default.
