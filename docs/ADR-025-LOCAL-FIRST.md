# ADR-025: Local-first, stated as rules rather than assumed

**Date:** 2026-08-11 · **Status:** Accepted · **Applies to:** every feature, retroactively

## Context

This should have been written at v1. It was not, and the cost of leaving it
implicit came due in August 2026.

Six Instagram carousels saved between 5 and 8 August looked perfect for four
days. Every slide rendered, the cards were right, the memos were in the correct
collection. On the fifth day they were blank. Nothing had broken that night:
nothing had ever been saved. The memos held Instagram's own signed URLs, the
browser fetched every slide from Instagram on every render, and when the
signatures expired the illusion ended. `cache_gallery` had been missing from the
job routing table, so the download that was supposed to make them real raised
"unrouted function" immediately after the commit and was never retried.

That was the loud failure. Measuring the library afterwards turned up the quiet
ones:

- **660 of 713 memos** carried `google.com/s2/favicons?domain=<site>` and the
  dashboard rendered it, so opening openMemo was one request to Google per card
  on screen, and a running disclosure to Google of every site in the library.
- **Every page load** fetched the typeface from `api.fontshare.com`, plus a
  Google Fonts stylesheet for two faces nothing rendered. With no connection,
  openMemo could not draw its own interface.
- **Half the phone captures** made between 9 and 11 August were saved into a
  different database, because a dev backend polled the same Telegram bot token
  and Telegram hands each message to exactly one asker.

Each was introduced by someone reasonable solving a real problem. None was
caught, because there was no rule to catch them against. Every one of them was
found by a user opening a card and seeing nothing.

The pattern is the same in all four: **openMemo behaved as though the network
would be there, and reported success before it had done the thing.**

## Decision

Three rules. They are not aspirations, they are testable, and each has a test
that fails the build.

---

## 1. A picture openMemo shows is a file openMemo owns

Not a thumbnail, not a carousel slide, not a playlist cover, not a site icon,
not "just while the download catches up".

**Why this is the core rule and not a detail.** The entire premise is that a
saved thing outlives its source. A card that fetches its own picture from the
source is not a saved thing, it is a live window onto someone else's server,
and it closes on their schedule. Worse, it *looks* saved right up until it does
not, which means the failure arrives with no warning and, by then, no remedy.

**Enforced at both ends, and both are needed:**

- `localize_pictures_inline` downloads cover and slides before the ingest
  commit, so local paths are what get written in the first place.
- `serve_pictures` (`backend/core/pictures.py`) strips any remote image URL
  from every outgoing payload. A row that slipped through renders a placeholder
  and reports `pictures_pending`. The URL stays in the database for the repair
  pass; it never reaches a browser.

The second half is what makes it an invariant rather than an intention. Every
way a picture can fail to localize has now happened at least once: an unrouted
job, a silent download failure, a fire-and-forget task lost to a restart. The
serving layer does not care which.

Site icons are the same rule at a smaller size, with one difference worth
naming: an icon is per **site**, not per memo. A 713-memo library resolves to 39
domains, so the whole library costs 39 small files and the fortieth Instagram
save costs nothing (`backend/core/favicons.py`).

**Test:** `test_picture_invariant.py` walks a deliberately broken memo past
every endpoint that renders it, and fails any payload builder that skips
`serve_pictures`.

---

## 2. Opening openMemo pings nobody. Only a deliberate act does.

Stated as the user did, because it is sharper than "rendering makes no network
request" and it puts the line in the right place:

> Loading openMemo contacts no outside host, ever. Browsing, searching, opening
> a memo: nothing. The only time a source is contacted is when I press play on
> something I already know is remote because it is a big video or track, and
> **then**, because I asked.

The distinction that matters is **the trigger, not the resource.** "Rendering
makes no request" is too weak: an embedded player is markup, so a rule about
markup lets the iframe mount on open and ping the host before anyone has
pressed anything. The user opened a memo; they did not ask to talk to YouTube.

So the test for any outbound request is: *did the person just ask for this
specific thing?*

**The nuances, stated narrowly so they cannot be stretched:**

| Allowed online | Trigger |
|---|---|
| Fetching new content | Saving a link, re-pulling a post, the bot relay polling. The act of going to get something. Offline it fails and says so. |
| Playing heavy media that was left remote | **Pressing play.** Not opening the memo, not scrolling past the card. A long video or track on a host with a working player is not downloaded unless `auto_download_video` / `auto_download_audio` says so, because a library of them fills a disk. Until play is pressed, the card shows the local poster we already hold. |
| Checking for a new version | Only when asked. It cannot be answered locally, so it belongs behind a button, never fired by opening a screen. |

Everything else comes off this machine. The typeface is vendored at build time
(`frontend/scripts/fetch-fonts.mjs`), the icons are fetched once per domain at
ingest, and `index.html` loads nothing at all.

Note what is **not** restricted: `source_url` is exactly what openMemo should
keep. Remembering where something came from is the point, and a stored link is
inert until clicked. Storing a remote URL is fine. *Reaching* it unasked is not.

**Test:** `test_offline.py` fails on any external URL in the app shell, any
remote `@font-face`, and any code that mints a Google-hosted favicon URL.

### Known gaps at the time of writing

Recorded rather than glossed, because an ADR that describes an aspiration as a
fact is worse than no ADR:

1. **Embedded players mount on open.** `PlatformEmbed` renders its `<iframe>`
   immediately, so opening a remote video memo contacts YouTube, Instagram or
   `platform.twitter.com` before play is pressed. The rule above says it must
   be a click-to-load facade over the local poster. Not yet built.
2. **The version check fires unprompted.** Settings and the changelog modal
   both call `api.github.com` on open. Best-effort and silent on failure, but
   nobody asked. It belongs behind a button.

---

## 3. "Saved" means the bytes are here

A memo may not report success before its content is on disk, and anything that
legitimately finishes later must carry that state where it can be seen: a
status column, a queued retry with a recorded reason, and a count in the hourly
integrity check.

**Why:** "it will finish in a moment" is not a state, it is a hope, and three
separate bugs have now hidden inside it. A background job that fails silently
is indistinguishable from one that succeeded, for as long as the source keeps
answering.

Consequences that follow directly:

- A download that fetches nothing **raises**. It gets the queue's retries and
  parks with a reason attached, rather than returning quietly.
- The integrity check counts pictures still on expiring hosts and names the
  memos holding them, instead of skipping remote URLs on the reasoning that
  they "are not ours to lose". For a signed URL that reasoning is backwards:
  it is ours to lose precisely because we failed to copy it while it worked.
- Best-effort is a legitimate choice, and it costs a status field. A picture we
  could not reach still saves the memo, because a missing picture beats a
  missing memo, but it is recorded as missing.

---

## Two supporting rules that come from the same root

**Registries get checked in both directions.** `queue_task(fn)` resolves
`fn.__name__` against a table in another file, at call time. An unrouted
function raises *after* the memo has committed, on one code path only. That is
how `cache_gallery` shipped unrouted with green CI. Whenever a call site names
an entry that lives in a table somewhere else, test that every entry resolves
**and** that every call site names one that exists. The second direction is the
one people forget and the one that catches the bug.

**Exactly one process may hold a single-consumer resource.** Telegram's
`getUpdates` hands each message to one caller and forgets it, so two backends
polling one token do not duplicate work, they split it at random into two
different databases. The Mesh device election cannot see this: it elects a
device, and two processes on one machine are one device. The guard is an OS
lock in the host temp dir, outside any `DATA_DIR`, so two backends with
different data directories still contend for it
(`backend/core/host_lock.py`).

---

## What this costs

Honestly accounted, because a rule with a hidden cost gets quietly dropped:

- **Ingest is slower.** Pictures download before the commit instead of after.
  A carousel costs about as long as its slowest slide, since they run in
  parallel. A few hundred KB and a second or two.
- **The build fetches the typeface.** 97 KB, four weights, cached after the
  first run. A failure warns and falls back to the system stack rather than
  breaking the build.
- **New domains cost one small fetch at ingest.** Nothing on repeat visits.
- **New endpoints have one more thing to remember**, and a test that remembers
  it for them.

Nothing here trades away the heavy-media decision, which is the one place
openMemo deliberately does not hold a local copy, and that stays deliberate.

## Status of the library at the time of writing

Measured, not assumed, after the repair pass:

- Remote pictures in the library: **0** (was 37)
- Memos holding zero bytes locally: **7** (was 44)
- Those 7 are uploads with no source URL, lost in the 4 August 2026 media wipe
  and recorded in `permanently-lost.csv`. Nothing can fetch them.
