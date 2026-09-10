# Parked: deciding downloads by predicted size

**Date** 2026-09-09
**Status** reverted, kept for later
**Reverted commits** `c93e331`, `b10ebea` (see `git show` for the full diffs)
**What shipped instead** one line: Facebook off `_EMBED_VIDEO_HOSTS`

---

## The problem it was solving

A memo saved from `facebook.com/share/r/1D7PWBAeUB/` held a thumbnail and
nothing to play.

The video was reachable the whole time. yt-dlp inside openMemo's own container
reads that exact link and offers eight formats up to 1920p. openMemo never
asked, because facebook.com sat on `_EMBED_VIDEO_HOSTS` — a list of hosts
trusted to play their own videos, whose members are deliberately not
downloaded. Fetching the player it would have used returns a page with no
video element and a login prompt, so the trust was misplaced and the list had
no way to find that out.

The same doorway inconsistency made it feel random: saves arriving through the
Telegram relay set `force_localize` and download regardless, while a paste into
the app obeys the list. Hence 324 of 324 Instagram videos on disk and a
Facebook link with nothing.

## What was attempted

Replace the host list with a size rule, on the argument that a host list is a
promise about the future you cannot keep and that the same host serves a
24-second reel and a two-hour stream.

- `predicted_bytes(data)` — the best rendition's size, from an exact
  `filesize` where the host reports one, otherwise `tbr × duration`.
- `should_keep_local(url, size)` — under `keep_local_max_mb` (100) keep it,
  over it save a link; no prediction falls back to the old host list.
- `POST /ingest/keep/probe` — so the New Memo panel could show the number.
- `keep_local` on `/ingest/url` — a per-save override, with a switch on the
  panel reading "Keep a copy (about 6 MB)".

Measured against three live links, it produced exactly the intended verdicts:
YouTube 2160p/213s → 509 MB → link; Facebook 1920p/24s → 6 MB → keep;
YouTube Short → under 1 MB → keep.

## Why it was reverted

A review found five things. The first is why it went back the same day.

**1. SSRF in the probe.** The host gate was `any(d in netloc for d in
_VIDEO_DOMAINS)`, a substring test, and `validate_url` has no private-address
check — `validate_proxy_url` exists for that and was not used. Confirmed
against the running container:

```
http://youtube.com@127.0.0.1:11434/api/tags
  validate_url  -> passes
  detect_url_type -> "video"
  -> handed to yt-dlp, which fetches 127.0.0.1:11434
```

Unauthenticated, no memo created, fast negative path. A cheaper internal
port-scanning primitive than anything else in the API.

**2. It could not see most of the library.** `predicted_bytes` is only attached
in the generic yt-dlp branch of `extract_video`. Instagram returns earlier
through `_instagram_resolve`, Threads through `resolve_threads`. Of 361 live
video memos with a file on disk, 36 are on hosts where a prediction is possible
at all. "Size decides now, not host" was false for 90% of saves.

**3. It predicted a different file than the one that downloads.** The predictor
takes the tallest format; `_video_format(0)` prefers `bestvideo[ext=mp4]`
first. A payload with an mp4 1080p at 2200 kbps beside a webm 2160p at
20000 kbps predicts 715 MB and refuses a download that would have been 79 MB.
Ties on height are also broken by list order, and yt-dlp lists worst-first, so
a tie takes the lowest bitrate — one constructed case predicted 71 MB for a
286 MB download.

**4. Two more shapes it did not handle.** A live stream has no duration, so it
falls back to the host list and on an unknown host downloads until the 1800s
subprocess timeout. `_probe_size` reads `splitlines()[0]`, so a playlist URL is
priced by its first track.

**5. The tests were weaker than the commit messages claimed.** One class
asserted its own arithmetic and called no product code. Nothing checked that
`extract_video` supplies `predicted_bytes` at all, so deleting that line would
have reverted the feature silently with every test green.

## What shipped instead

Facebook removed from `_EMBED_VIDEO_HOSTS`. Its videos download like any host
without a dependable player. Everything else on the list keeps its old answer.
Covered by `backend/tests/test_facebook_video_downloads.py`, which asserts both
halves — Facebook moved, nothing else did.

Known cost: a long Facebook video now downloads in full. Clips are small (five
in one library, median 3.6 MB), so the exposure is a rare long video rather
than a routine one.

## If this is picked up again

- Predict the rendition `_video_format` will actually select, `ext` and all,
  not the tallest one.
- Break height ties on bitrate, and handle formats that report no height.
- On DASH, add the audio track's size; `tbr` on a video-only format excludes it.
- Decide what a missing duration means, explicitly. A live stream is the case
  that matters.
- Attach a prediction to the Instagram and Threads resolvers, or accept in
  writing that the rule only covers yt-dlp hosts.
- Any probe endpoint that reaches out on a user-supplied URL uses
  `validate_proxy_url`, parses the host rather than substring-matching it, and
  is bounded by a semaphore. `asyncio.to_thread` shares the executor with
  downloads and transcription.
- The panel switch must not appear where it does nothing: the playlist branch
  never sends it, and an audio host ignores it.
- Before claiming a cap or a rule is gone, grep for every default that supplies
  one. `aa88ce3` removed the 1080 ceiling from the format selector and three
  other places went on supplying 1080, which made the headline change a no-op
  until `d15055a`.

## What was kept from that day

- `aa88ce3` + `d15055a` — no resolution ceiling by default, opt-in
  `video_quality_cap` in Settings.
- `ab6ed58` — the Instagram login-only tiers ask for a login.
- `acccddd` — a memo titled with a bare handle can be repaired.
- `4204518` — the caption reader reports when it stops working.
- `2c59b72` — the Instagram warning fires on failure, not on having no login.

---

# Parked, part two: the Instagram health work

The four Instagram commits shipped. A second review found real defects in them
too. One was a regression and was fixed the same evening (`f0…`, the canary
roll-up). The rest are recorded here, not fixed, deliberately.

## Fixed, because it made things worse than before

**The canary roll-up swallowed a mismatch.** The per-check verdict was
reordered so content is compared before the tier is considered. The roll-up
underneath it was left in the old order, so with a sample of two, one clean
browser-tier read reported "degraded" and Settings no longer alarms on that. A
carousel returning one slide out of ten went from loud to **silent** — the
single thing the canary exists to catch. Reordered, and covered by a test that
drives `run_instagram_canary` with two memos and fails when the order is put
back.

Also removed: the health route alarmed on a canary status of `"error"`, which
`run_instagram_canary` never returns. It is a per-check outcome; a run where
every check raised comes back `"skipped"`. The arm looked like coverage and
covered nothing.

## Open, with evidence. Worth a session of its own

1. **A resolver crashing on every post is silent.** All-error rolls up to
   `"skipped"`, which no longer alarms. `test_a_resolver_crash_never_escapes`
   pins that on purpose, so changing it is a decision rather than a fix.

2. **The caption alarm cannot fire on a logged-in install.**
   `_instagram_text_from_og` is reachable only from tiers 4 and 4b. A library
   with a working session resolves at tier 1 or 2 and never touches it, so
   `caption_parse_health()` stays empty forever and `unreadable` is
   unreachable. 253 of 385 tagged Instagram memos here are `api-cookie`. The
   API tier's own caption reading is not monitored at all.

3. **`broken` needs 100% failure.** One success in the 20-entry window silences
   it, so a partial rewording or a staged rollout never alarms.

4. **The alarm is coupled to the wording it watches.** `parse_failed` requires a
   username, and a rewording will likely break the handle pattern at the same
   time. `_instagram_text_from_og("Instagram", "Log in to see photos…")` counts
   nothing. Mutating `bool(username)` to `True` leaves all 13 tests green.

5. **`_og_offers_a_caption` has false positives.** Any quote character anywhere
   in either tag counts as an offer, and any colon after a `" on "` does too —
   so a date carrying a time reads as a caption being offered. Five such posts
   in a row and a healthy library reports `unreadable`.

6. **It is English-only in the direction that matters.** A Spanish, German or
   French `og:description` carrying a real caption returns no username and no
   caption, and `parse_failed` is False. On those installs the reader is
   already broken and `checked` stays 0 forever.

7. **A ratio is the wrong shape for the failed-tier count.** Five of the last
   twelve saves failing outright is silence, because `_IG_HEALTH_RATIO` is 0.5
   and `IG_FAILED_TIERS` now holds one rare tier. Nothing pins 0.5 and there is
   no mixed-window test.

8. **An expired session is invisible.** `_has_ig_session` never reads the
   cookie's expiry, so an expired `sessionid` passes, `session_status()` says
   connected, saves fall to browser tiers, `blocked` is 0, the status is `ok`,
   and the new quiet note is gated on `!connected` so it is suppressed too.
   Nothing at all appears. Before the split, that case warned.

9. **The download path still asks the old question.**
   `localize_media.py` `_localize_via_instagram_api` still gates on
   `cookies_present()`, so every Instagram video download still pays the
   un-authenticatable second call. The extractor half was fixed; this twin was
   missed. Its own docstring claims it mirrors the extractor's ladder.

10. **The handle guard is defeated by first-line truncation.**
    `_instagram_titles` takes `caption.splitlines()[0]`, so a caption whose
    first line is only a mention collapses to exactly `@handle` and is
    indistinguishable from the no-caption fallback. Live example:
    `@rengodms_sendai_` holds 114 characters of Japanese whose first line is
    the handle. The test asserting that case is protected does not protect it.
    Of the 26 newly replaceable titles, 24 are genuine fallbacks and 2 hold
    the author's words.

11. **Replacing a handle title can be a downgrade.** When the guard opens,
    re-pull overwrites description and content_text too. A re-resolve landing
    on tier 5 supplies the needs-login blurb and a bare URL, all truthy, so a
    real caption is replaced by an error message. Pre-existing for
    "Instagram post" titles; widened to 26 more memos.

12. **The handle pattern is generic and runs for every host.** It accepts
    `@media`, `@types`, `@tanstack`, `@home` — plausible one-word bookmark
    titles — and degenerate strings like `@.` and `@_`. On non-Instagram hosts
    that land on `scope:page` there is an automatic re-resolve, so such a memo
    can be overwritten with no user action.

13. **The canary can now false-alarm on a memo the user changed.**
    `_expected()` compares stored type against resolved type with no
    allowance, and one Instagram memo here was converted to audio by hand. Now
    that `mismatch` is the only alarm arm, that matters more than it did.

14. **The canary verdict still has no expiry.** Narrowing which statuses count
    did not add one. A `mismatch` — including a false one from 13 — holds the
    banner up indefinitely, and the loop reruns weekly on the Mesh singleton
    only.

## Claims in the changelog that did not hold, now corrected

Three sentences in the unreleased changelog promised more than the code does.
The code was left alone and the sentences were narrowed on 2026-09-10, before
any of it reached a release. What they said, and what they say now:

1. "A caption that merely starts with a mention is still your words and is
   left alone." Falsified by `@rengodms_sendai_`, whose 114 characters of
   Japanese have the handle alone on the first line. The entry now says that a
   caption starting with a mention and carrying on is safe, and one that is
   only a mention on its first line will be replaced.
2. "Every single save paid for two attempts." True of the save path and read
   as a complete fix. The download path still asks the old question, finding 9
   above. The entry now says so.
3. "openMemo will notice if it ever stops being able to read Instagram
   captions." Not on an install with a working login, which resolves at a tier
   the counter never sees, and not in a non-English locale. The entry now
   scopes the claim to public-page reads and to English wording.

## Tests that would pass with the feature broken

- Nothing covered the canary reorder at all until the fix above. The
  pre-existing tier test passes under both orders.
- `test_a_page_that_named_nobody_is_not_a_failure_either` passes for an
  unrelated reason: both inputs also fail `_og_offers_a_caption`.
- `test_a_post_that_simply_has_no_caption_is_not_a_failure` uses an empty
  `og_title`, which Instagram never serves for a readable post.
- Nothing exercises `_IG_HEALTH_RATIO`, a mixed window, or the
  `session_expired` branch.
- `caption_parse_health()` reads process-global state that another test file
  also writes into; only one of the four tests clears it.

---

# Part three: the ledger for 2026-09-09 and 2026-09-10

The two days above were one working session. This is what went in, what came
back out, and what is still owed, so none of it has to be reconstructed from a
chat log. The durable decision that came out of it is ADR-028 in
`docs/DECISIONS.md`.

## What was reported, and what each thing turned out to be

Seven items were raised at the start. Every one was diagnosed by running the
real code path, never by reading it, which is the only reason two of them did
not become fixes for problems that did not exist.

| Reported | Cause | Outcome |
|---|---|---|
| The Appearance panel jitters many times a second | The panel measures its own content and animates to fit; the new height crossed the scrollbar threshold, the scrollbar took width, the content rewrapped, and the measurement ran again | Fixed. `scrollbar-gutter: stable` plus a sub-pixel guard |
| Instagram stopped pulling a title and description | The caption was never missing. Instagram writes author and caption into the tags it serves a link preview; the code read that page and threw the words away | Fixed. The caption becomes the memo |
| The extension pulls one image, not the carousel | The extension scraped the page itself, a path that never walked the carousel and never recorded how the post was read | Fixed. The extension hands the link to the backend for any host openMemo can read |
| A play button appears on video thumbnails | Not ours. Opened `files/thumbs/*.jpg` directly: the glyph is baked into the poster JPEG Instagram serves | No change. Removing it is not possible from our side |
| The music relay says "0 days left" forever | The session is 12 hours, read from `data/app_settings.json`, and the UI only ever rendered days | Fixed. `relayTimeLeft` picks days, hours or minutes |
| Facebook memo with nothing to play | `facebook.com` was on the trusted-player list and the trust was misplaced | Fixed. See ADR-028 |
| Profile README's model list is stale | Content, not code | Separate repo. `izored/izored` PR 1 |

## What shipped on this branch

Twelve commits. Ordered as they landed.

- `aa88ce3` + `d15055a`. No resolution ceiling by default, opt-in
  `video_quality_cap` in Settings. The second commit exists because the first
  removed the 1080 ceiling from the format selector while three other places
  went on supplying 1080: the durable queue's replay default, the API client's
  default argument, and the memo page's initial picker value. So "Make it
  local", the button pressed precisely because someone wants to keep the thing,
  was the one path still capped.
- `ab6ed58`. The two Instagram tiers that need a login now ask whether the
  cookie jar holds an Instagram session, not whether a jar exists. The jar is
  shared with every other site, so one YouTube cookie made it look signed in and
  every save paid for two attempts that could not work.
- `acccddd`. A memo titled with a bare handle can be repaired by re-pull.
- `4204518`. The caption reader counts the reads it could not parse and reports
  when it stops working.
- `2c59b72`. The Instagram warning fires on a save that came back with nothing,
  not on a save that had no login.
- `6812c1a`. The revert. `c93e331` and `b10ebea` out, Facebook off the
  trusted-player list, this document created.
- `6fc20dd`. The canary roll-up regression, described in part two.
- `ca734f5`. A drop always saves, wherever it lands.

## Drag and drop, increment 3

Dropping a link was researched on the assumption it did not exist. It did:
`FileDropLayer` has read `text/uri-list` since increment 2. The real defect was
where the drop landed, not what was dropped.

`resolveDropTarget` returned `prefill` for a bare library, so a drop on the
dashboard, the Spaces list, the Collections list, a memo page or Ask opened the
New Memo panel and waited. The dashboard is where you land, so the form was the
thing most people met. A form is hard to tell apart from the feature being
broken.

It now saves to the library, which is where every other unfiled memo already
goes. The only remaining panel case keys on **what** was dragged rather than
where it was dropped: selected text with no link in it becomes a note, and a
note needs a title nothing can invent.

That rule had **no test at all**, which is how it survived being wrong for two
increments. It has six now, and they were proved by setting the branch back to
`prefill` and watching exactly two fail.

Written up as ADR-023 section 6, with section 4 marked superseded.

## Open, owed, or deliberately not done

- **Fourteen Instagram findings** in part two above. Not fixed, on purpose.
  Numbers 2, 9 and 10 are the ones worth reading first: the caption alarm cannot
  fire on a logged-in install, the download path still asks the old cookie
  question the extractor stopped asking, and the handle guard is defeated by a
  caption whose first line is only a mention (`@rengodms_sendai_`, 114
  characters of Japanese).
- **The size rule**, if it is ever picked up, has its checklist in part one.
- **ADR-023 follow-ups**: per-card drop targets, folder drops, removing the now
  unused `pendingDropFiles` store slice, and checking the saved confirmation is
  loud enough for a library drop.
- **One memo needs a manual re-pull**: the Facebook memo
  `97cd6743-4b83-4c2d-898c-d790eed87340` still has no file. The code that fixes
  it is in this branch, so the re-pull has to happen after the rebuild.
- **The host was missing two declared dependencies, and now has them.**
  `mnemonic` and `qrcode` are both declared in `backend/requirements.txt` and
  were already installed in the container and in CI, but not in the Windows
  host Python. That made 27 Mesh tests error on import there. Both were
  installed into `C:\Program Files\Python312` with `python -m pip install
  --user` on 2026-09-10, while cutting v3.20.0. `python -m pytest backend/tests
  -q` on the host now reports 939 passed, 1 failed, 18 skipped. The one failure
  is `backend/tests/test_mesh_discovery.py::test_browsing_without_a_network_returns_nothing_rather_than_raising`,
  which raises `ValueError: not enough values to unpack (expected 2, got 0)` at
  `backend/core/mesh/discovery.py:137`. That is unrelated to the missing
  packages and has its own follow-up. The host suite is not fully green.

## Process notes worth keeping

- **A test that was never seen to fail is not a test.** Two written this session
  passed against broken code. The Instagram session gate test passed because
  `cookies_present()` reads a real jar path that does not exist under pytest, so
  the gate was never exercised; fixed by patching it to `True`. The keep-local
  override test re-evaluated the route's own condition instead of calling the
  route, and passed while the field it asserted on had never been added to
  `URLIngest`. Rewritten to drive `/ingest/url`, it failed immediately and found
  the missing field.
- **A source-grep test costs more than it protects.** One asserting `"1080" not
  in src` failed on the explanatory comment saying why 1080 had been removed. It
  was deleted rather than reworded.
- **The first caption alarm counted a captionless post as a parse failure**,
  which is the exact false positive the alarm exists to avoid. `_og_offers_a_caption` was added to separate them, and part two records that the separator
  has its own false positives.
- **CI caught what local runs did not.** A new test file left three
  fallback-tier Instagram memos in the shared test database, which flipped
  `test_an_empty_library_reports_ok_not_a_problem` to `no_session`. The fix is a
  fixture that deletes them; it was reproduced locally before and after.
- **`git checkout -- <file>` inside a mutation test wiped uncommitted work.**
  The suite caught it, two failures, and the change was reapplied by hand. A
  mutation test edits and restores the file itself; it never reaches for git.
