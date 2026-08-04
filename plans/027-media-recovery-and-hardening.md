# 027 — Media recovery and hardening

Written 2026-08-04, the day an unisolated test run deleted 435 media files from
the live library and disk recovery returned nothing usable.

The lesson is not "back things up". The failure was **silent in every
direction**: nothing prevented it, nothing noticed it for ninety minutes, and
nothing could undo it. A plan that only adds backups fixes one third of that.

## Where things stand

Verified against the live database on 2026-08-04:

| | Count | Status |
|---|---|---|
| Memos, notes, captions, tags, collections, transcripts | 693 | **intact** — the database was never touched |
| Card thumbnails (`files/thumbs`) | 690 | **intact** — never deleted |
| Memos with media referenced but missing | 435 | — |
| — re-downloadable from `source_url` | 376 | recoverable, automatable |
| — uploads with no source | 59 | **lost** unless a copy exists elsewhere |
| Link-preview images (`files/extracted`) | 38 refs, 0 files | gone; cosmetic |
| Disk recovery attempt | 0 files | failed: 742 zeroed by TRIM, 691 overwritten |

The 376 by host: Apple Music 177, YouTube 113, Instagram 52, Spotify 11, and a
24-file tail. All of them are `audio` (296) or `video` (80), so every one goes
through the same localize pipeline. The 59 lost uploads: 24 images, 23 audio,
9 video, 3 other.

The library is not broken — it is missing its media. Every memo still knows what
it was, which is what makes both re-downloading and hand-hunting possible.

---

## Phase 0 — Safety gate (nothing else until this is done)

**Merge [PR #136](https://github.com/izored/OpenMemo/pull/136).** Until it is on
`main`, running `pytest` from the main checkout wipes `files/` exactly as it did
on 2026-08-04. Re-downloading 376 files before that risks losing them twice.

- [ ] Merge PR #136 (checks green, mergeable as of writing)
- [ ] `git pull` in the main repo
- [ ] `docker compose build openmemo-api && docker compose up -d`
- [ ] Confirm `pytest backend/tests -q` passes **and** `files/thumbs` still holds 690 files

**Done when:** the isolation guard tests exist and pass on `main`.

---

## Phase 1 — Get the 376 back  *(tool shipped)*

`backend/refetch_missing_media.py`. Selects memos whose `file_path` resolves
nowhere but whose `source_url` is set, and pulls each back through
`localize_memo_task` — the same path a live "make it local" takes, so Apple
Music and Spotify go to their track resolvers and everything else to yt-dlp and
the sniffer. No new download code.

Dry run by default. Oldest first, paced, resumable, `--host` and `--limit` to
narrow. Prints the database and files directory it is about to use, because the
whole incident was a script pointed at the wrong one.

```
docker exec openmemo-openmemo-api-1 python -m backend.refetch_missing_media
docker exec openmemo-openmemo-api-1 python -m backend.refetch_missing_media --host music.apple.com --limit 5 --apply
```

Expect the mix to behave differently: Apple Music and Spotify go through the
track resolvers, YouTube is straightforward, Instagram works now that a session
is connected, and the tail will have real losses from deleted posts.

**Done when:** the missing count drops from 435 to ~59 plus whatever genuinely
no longer exists at its source.

**Run on 2026-08-04: 182 recovered, 194 still missing.**

| Host | Recovered | Left | Why |
|---|---|---|---|
| YouTube | 109 | 4 | the four are deleted at source |
| Instagram | 51 | 1 | post gone |
| x.com, Threads, Facebook, SoundCloud, Vimeo, Dribbble | 21 | 0 | |
| suno.com | 0 | 1 | yt-dlp cannot read it |
| **Apple Music** | 0 | **177** | **blocked, see below** |
| **Spotify** | 0 | **11** | **blocked, see below** |

**The 188 tracks are blocked, not failed.** Both resolvers end at the SpotiFLAC
community endpoint, and all three of its hosts are NXDOMAIN as of 2026-08-04:

```
qbz-foss.spotbye.qzz.io   tdl-foss.spotbye.qzz.io   amz-foss.spotbye.qzz.io
```

Confirmed from inside the container and from the host, so it is the service and
not the network. `backend/core/spotiflac.py:47` inlines those hostnames from the
upstream binary. Recovering the 188 needs a current endpoint from
[spotbye/SpotiFLAC](https://github.com/spotbye/SpotiFLAC), or a different
provider. Until then every Apple Music and Spotify pull in openMemo is down —
this is not specific to recovery.

---

## Phase 2 — The 59, by hand  *(tool shipped)*

`backend/list_lost_uploads.py` writes a CSV checklist with, for each file: the
type, the title, the date added, its collections, your own notes, and a link to
open the memo. The filename is a UUID and useless for searching — **search by
type and date**, then confirm by reading the memo.

Worth checking: phone camera roll / Google Photos / iCloud around the memo's
date; `Downloads`, `Desktop`, `Documents` on every drive; the device the audio
was recorded on (23 of the 59 are audio); any project folder the memo's
collection points at.

**Done when:** every row is either recovered or accepted as lost.

---

## Phase 3 — Backups that produce ONE file  *(shipped)*

`backend/core/archive.py`, hourly tick running whatever scope is due, surfaced
in Settings → Backup & Restore with a destination field and per-scope "Run now".
`GET/POST /api/backup/archives`. Retention is per scope, so fourteen daily
database archives cannot age out the monthly full one. Covered by
`test_archive.py`.

`essential` is also a download scope on `POST /api/backup?scope=essential`. Its
metadata declares `scope: full` so restore treats its media as media, with
`archive_scope` recording what it really is.

The original shape of the requirement, kept for the record:

openMemo already builds a single zip (`POST /api/backup?scope=full`), but it
only streams to a browser download — so a backup exists only if someone
remembers to click. Make it a **scheduled archive written to a chosen folder**:

| Setting | Default |
|---|---|
| Destination folder | outside the app directory |
| Scopes | `database` (7 MB) / `essential` (DB + uploads, ~2 GB) / `full` (~25 GB) |
| Schedule | database daily, essential weekly, full monthly |
| Keep | 14 / 4 / 2 |
| Verify after write | on |

**`essential` is the important one.** Database plus every file with no
`source_url` — precisely the irreplaceable set. On today's numbers ~2 GB, and it
would have contained all 59 lost uploads. Small enough to keep many copies and
to sync off-machine.

Rules baked in:

- **Verify before counting.** After writing, open the archive, confirm the
  database inside is valid SQLite with a `memos` table, record the row count. An
  archive that fails verification does not count toward retention and does not
  age out a good one.
- **Refuse to archive nothing.** An empty media directory is a symptom, not a
  state to preserve. Fail loudly, keep the previous archives.
- **Destination outside the app directory,** so wiping the app cannot wipe its
  backups.

The external `Backup-Master.ps1` then copies one file — no `Folder` mode and no
named-volume migration needed.

**Done when:** a scheduled archive exists, verified automatically, and has been
**restored once** into a scratch location to prove it works.

---

## Phase 4 — The alarm that was missing  *(shipped)*

`backend/core/integrity.py`, on an hourly timer from the lifespan, surfaced in
Settings → Backup & Restore via `GET /api/settings/library/integrity` and a
"Check now" button. Every paired device runs its own, unlike the Instagram
canary: it is a question about the local disk.

Any increase since the last run is an `incident`, shown in red. A gap that has
not grown is `missing`, shown in amber. The first run on an existing install
never reports an incident, or every library with old gaps would open to a red
alert about a loss from months ago. Covered by `test_library_integrity.py`.

The original shape of the requirement, kept for the record:

- Resolve every `file_path` in the database. Count what is missing.
- Compare with the previous run. A jump from 0 to 435 is an incident, not drift.
- Surface it in Settings immediately: *"435 media files referenced by your
  library are missing from disk."*
- Same treatment for thumbnails — that is how the broken cards would have been
  caught weeks earlier.

Had this existed, the loss would have shown up in the app at 12:35 instead of in
a screenshot at 14:00 — inside the window where recovery was still viable.

**Done when:** deleting a single test file makes Settings say so within one
check interval.

---

## Phase 5 — Runbook  *(shipped: `docs/DISASTER-RECOVERY.md`)*

What had to be improvised on the day: stop every write first, never install
recovery tools onto the affected drive, recover to a different drive, check the
bytes are real before trusting a file count, then match and restore.

Plus the rule that prompted all of it: **never write to or delete from live
data. Read-only always. Test suites never point at production paths.**

---

## Already shipped (PR #136)

- `FILES_DIR` is isolated in tests, and `test_test_isolation.py` fails the suite
  if any user-data path escapes a temp directory — the exact bug.
- Restore **moves** media to `data/pre-restore/<timestamp>/` instead of deleting.
- A "full" archive containing no media no longer clears media.
- `POST /api/backup/inspect` says what a restore will do before it does it.

---

## Order and why

Phase 0 is a gate. Phase 1 is the big win and runs unattended. Phase 2 is manual
and can happen whenever. Phases 3 and 4 are what make this survivable if it
repeats — **4 is the one not to skip**, because backups only help if you learn
you need them in time.
