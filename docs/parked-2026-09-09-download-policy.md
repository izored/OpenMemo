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
