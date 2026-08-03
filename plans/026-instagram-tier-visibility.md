# 026 — Make a silent downgrade impossible to miss

Status: done (2026-08-03)
Follows: `plans/025-instagram-video-capture.md`

## Why

The reel bug in plan 025 lived for six weeks and nothing ever failed. The tier
ladder kept returning memos — a reel as a still, a carousel as one photo — so
every layer reported success. The only evidence was the memos themselves.

A ladder that degrades silently needs the degradation recorded somewhere.

## What was built

### 1. Every memo records the tier that produced it

`memos.resolve_tier`, e.g. `instagram:api-cookie` or `instagram:browser-render`.
Written by `_instagram_resolve` at every exit, persisted by both ingest paths
and by the backfill. `IG_TIERS` is ordered best to worst; `IG_FALLBACK_TIERS`
is the set that means "we could not read the post properly".

### 2. Settings says so out loud

`GET /api/settings/instagram/health` looks at the last 12 tagged Instagram
saves and reports `ok`, `no_session`, or `session_expired` — it distinguishes
"never connected" from "the jar is there and Instagram stopped accepting it",
so the suggested fix is the right one. Below half the window, nothing is said:
one throttled save is noise.

An untagged library (every install the day this ships) reports `ok` with
`checked: 0`. Silence about the unknown, not an accusation.

### 3. A weekly canary

`core/canary.py` re-resolves two posts already in the library and compares the
result against what is stored: a fallback tier is `degraded`, fewer slides than
stored is `mismatch`. Self-calibrating on purpose — hardcoded canary URLs rot
the moment their author deletes the post, whereas the library always holds
posts known to have resolved properly once. Runs from lifespan behind the Mesh
singleton (one device, not both), stores its verdict in app settings, and feeds
the same Settings banner. `python -m backend.core.canary` runs it on demand.

### 4. Captions backfill

`--captions` fills the real caption on memos whose media is already here but
that still say "Instagram post". Never overwrites a user-written title.

## Guard rails that caught real mistakes

The repo's own contract tests rejected the first attempt three times, exactly
as designed:

- `resolve_tier` had no merge policy → added to `MACHINE` (generated, absence
  never wins: the device that saved the post knows how well it resolved).
- `core/canary.py` imported Mesh → added to `CORE_FILES_TOUCHING_MESH` with the
  reason, rather than letting the dependency slip in unannounced.
- `instagram_canary` sat in `_DEFAULTS` but was not writable through the API →
  it is a health *record*, not a preference, so it moved out of `_DEFAULTS`
  alongside the passcode and bot token, and `get_settings()` strips it.

## UI fixes reported during the work

- The gallery count badge moved from top right to top **left** on memo cards:
  the hover tools occupy the top right and covered it.
- The lightbox pages carousel slides from any entry point, not just the memo
  page. Controls sit ON the picture: the wrapper is `inline-block` so it
  shrink-wraps the photo (a flex wrapper let the `<img>` take the full width
  and `object-fit: contain` letterboxed it, putting the arrows 219px out in the
  dark), and the height cap is in viewport units because `max-height: 100%`
  cannot resolve against an auto-height parent.

## Operational note (cost a live outage)

Do **not** run a host-side backend against `data/openmemo.db` while the Docker
stack is serving the same file. SQLite WAL needs a `-shm` file, and Docker
Desktop's bind mount and the Windows host do not share it: after the host
process exited, every new connection inside the container failed with "unable
to open database file" and `/api/memos` returned 500 until the container was
restarted. Use a throwaway container against the mounted data instead, which is
how the backfills and the canary were run.
