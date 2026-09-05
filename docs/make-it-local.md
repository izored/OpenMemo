# Make it local

"Make it local" downloads a remote media memo into a real local file stored
inside OpenMemo's `files/` directory via the backend localize flow.  Once
downloaded the memo plays offline and survives the original source being
deleted, privated, or geo-restricted.

> **Rationale:** See [ADR-003 in docs/DECISIONS.md](DECISIONS.md#adr-003--make-it-local-visibility-is-gated-to-remote-localizable-media-tiered-capture) for the architectural decision behind the tiered capture strategy and why the panel is gated to `video`/`audio` memo types only.

---

## What it does

1. The user opens a remote **video** or **audio** memo detail page.
2. They see the **Make it local** panel with a download mode selector and a
   "Save … in openMemo" button.
3. Clicking the button calls `POST /api/memos/:id/localize` with a `mode` of
   `video` or `audio`.
4. The backend queues a yt-dlp download job. `localize_status` advances through
   `pending → processing → done` (or `error`).
5. The detail page polls every 2.5 s while the job runs and shows a spinner.
6. When `localize_status === 'done'` the memo gains a `file_path`.  The page
   re-renders the local player (video `<video>` or `AudioMemoPlayer`) and hides
   the "Make it local" panel.

---

## Gating predicate — `canMakeLocal(memo)`

**File:** `frontend/src/lib/media.ts`

```ts
export function canMakeLocal(memo: Memo): boolean {
  return (
    (memo.type === 'video' || memo.type === 'audio') &&
    !!memo.source_url &&
    !memo.file_path &&
    memo.localize_status !== 'done'
  );
}
```

All four conditions must be true:

| Condition | Reason |
|---|---|
| `type === 'video' \| 'audio'` | Only yt-dlp–supported media types can be localized. Articles, links, images, notes, documents, code, and generic files are excluded. |
| `source_url` present | The memo must have a remote origin. Locally-uploaded files already have a `file_path` and no need to download. |
| `!file_path` | A local file already exists — nothing to download. |
| `localize_status !== 'done'` | Belt-and-suspenders: even if `file_path` is somehow missing, a completed job must not re-trigger. |

---

## Where it appears

There is exactly one render site per media sub-type, both in
`frontend/src/pages/MemoDetail.tsx`, gated by `canMakeLocal()`:

### Remote audio (`type === 'audio'`)

```tsx
{!isEditing && canMakeLocal(memo) && memo.type === 'audio' && (
  memo.localize_status ? (
    <MakeItLocalPanel memo={memo} />   // download in progress or error
  ) : (
    <AudioStreamEmbed memo={memo} />   // no job yet — offer stream + save
  )
)}
```

When there is no active localize job, `AudioStreamEmbed` is shown first: it
renders a platform embed widget (SoundCloud/Mixcloud) so the user can listen
before committing to a download.  The "Save audio in openMemo" button inside
that component also triggers `memoApi.localize()`, which kicks off the same
backend job and transitions the UI to `MakeItLocalPanel`.

### Remote video (`type === 'video'`)

```tsx
{!isEditing && canMakeLocal(memo) && memo.type === 'video' && (
  <MakeItLocalPanel memo={memo} />
)}
```

Video memos always jump straight to the panel because the platform iframe embed
(YouTube, Vimeo, etc.) is already shown above it; there is no separate "watch
before saving" step.

---

## Download modes

`MakeItLocalPanel` offers:

| Mode | Available for | What it saves |
|---|---|---|
| `video` | `type === 'video'` only | Up-to-1080p video file |
| `audio` | both types | Audio-only copy — an **explicit** video→audio (podcast) conversion that replaces the video view |

Audio-type memos (`type === 'audio'`) skip the mode selector and always use
`audio`.

> **Not the transcript path.** Getting a transcript is a separate,
> non-destructive action (**Get transcript** on the Transcript tab) that never
> downloads the media or changes the memo type — the video stays embedded. The
> old `audio_transcript` mode was removed. `Make it local → Audio only` is now
> purely a deliberate podcast conversion (the UI warns it replaces the video).
> See [ADR-004 in docs/DECISIONS.md](DECISIONS.md#adr-004--transcript-extraction-is-decoupled-from-file-capture-non-destructive-caption-first).

---

## End-to-end user flow

```
User saves a YouTube / Vimeo / SoundCloud / TikTok / ... URL
         ↓
Backend classifies it as type "video" or "audio"
         ↓
MemoDetail shows iframe embed (video) or stream embed (audio)
  + "Make it local" panel (video) / "Save audio" button (audio stream)
         ↓
User picks mode (video or audio) and clicks Save
         ↓
POST /api/memos/:id/localize { mode }
   → localize_status: "pending"
         ↓
Backend yt-dlp job runs
   → localize_status: "processing"
         ↓
Download complete
   → localize_status: "done", file_path set
         ↓
Detail page re-renders:
  - canMakeLocal() → false  (file_path now set)
  - "Make it local" panel disappears
  - Local video player or AudioMemoPlayer appears
  - Transcribe button becomes available (if audio track was saved)
```

---

## The download ladder (and why videos used to arrive silent)

`backend/core/localize_media.py` tries several routes for the same file, in
order, and stops at the first one that produces a **playable file with sound**.
The order exists because no single downloader handles every host.

| # | Tier | Used for | Notes |
|---|---|---|---|
| 0 | Instagram guest media-info API | `instagram.com` only | Returns `video_versions[]`, ordinary progressive MP4s with the audio already muxed in. Highest resolution wins. |
| 1 | Network sniffer (`core/sniff_media.py`) | Threads, Instagram, and as a universal fallback | Loads the page in the headless browser, watches every network response, downloads the media directly with the Referer the browser used. Scoped to the post, so it cannot capture a neighbouring post's clip. |
| 2 | yt-dlp | Everything else | Also the fallback whenever a tier above fails. |

### The other failure mode: the post next door

A permalink page is not a post. It is one post sitting on top of a feed of other
posts, and the sniffer's own strategy is "play what is here and take the biggest
media response". On a Threads photo carousel that produced a memo holding a
1.4 MB clip belonging to a completely different author, filed under a caption
that had nothing to do with it.

Every reader that looks at a page can now be scoped to the post first.

1. **`core/permalinks` says which URLs name one post.** It returns a `prefix`
   (the path down to the post id, slug and query dropped) and a `kind` token
   (`post`, `p`, `status`, `comments`, `video`). Threads, Reddit, X, Instagram,
   TikTok, Bluesky and Facebook are one list; anything not on it is simply not
   scoped, which is the old whole-page behaviour.
2. **`headless.render_page(scope_permalink=…)` finds the post's subtree.** It
   walks out from the post's own permalink anchor and stops at the first
   ancestor that links to a *different* permalink of the same kind. What is left
   is the post. Nothing in that walk knows which site it is on.
3. **Every reader then works inside the tag.** Largest image, stage image,
   gallery, text, and the sniffer's play-every-video pass.
4. **A scoped post with no player of its own answers "nothing to download".**
   Rather than handing back whatever else the page loaded. A scope that comes
   back *empty* is not trusted for that, so a page the walk could not read keeps
   the old, unscoped pick.

Two things fall out of the same pass. A carousel is read by **enumerating** the
scope rather than by clicking Next, which is the only thing that works on
Threads, where the slides are a horizontal strip with no Next control at all.
And slides are taken from the widest `srcset` entry rather than `currentSrc`,
because a carousel renders at thumbnail size and `currentSrc` hands back the
320 px rendition of a 3072 px photograph.

`core/social` then types the post from what it holds: a clip inside the post
makes it a video, stills make it an image with a gallery, and a scope with text
and no media is a text post. The domain is never a signal. Every `reddit.com`
URL is not a video, and every `threads.com` URL is not a video.

### Cookie-consent gates

Meta serves a cookie screen *instead of* a Threads or Instagram post to a cold
browser profile. It parses perfectly, into a memo whose body is the cookie
policy and whose content is a list of "Learn more" links. The renderer now
clicks a **decline** control before reading anything, on every host, and
recognises the gate if it survives the click so it is never parsed as the page.
The button list is decline-only by construction: there is no label in it that
can match an "Allow all" or "Accept" button.

### The silent-video failure mode

Instagram (and any DASH host) does **not** serve a clip as one file. The picture
and the sound are two separate representations, fetched as two separate
responses. That breaks the obvious strategy — "download the biggest media file
this page loaded" — because the biggest one is the video with no audio in it.
The download succeeds, the file plays, and there is nothing to hear.

Four defences, all of which had to be in place:

1. **Tier 0 exists at all.** Instagram's own API hands over a progressive MP4
   with the audio inside. Asking for that first sidesteps DASH completely, and
   it is what fixes the overwhelming majority of reels.
2. **The browser plays unmuted.** Chromium only permits *muted* autoplay by
   default, and a muted DASH player never requests the audio representation —
   so there was no sound on the wire to capture. The browser is launched with
   `--autoplay-policy=no-user-gesture-required` and the player is started
   unmuted, with a muted retry as the fallback.
3. **The sniffer keeps listening.** It used to return the instant a large media
   response landed, which on DASH is the video half. It now waits an extra
   `_AUDIO_GRACE_MS` for the audio half, and returns **every** response it saw
   (`candidates`), not just the biggest.
4. **A silent download is repaired, not accepted.** `_recover_audio` fetches the
   audio candidate, verifies it with ffprobe (never trusting `Content-Type`),
   and muxes it onto the video with `ffmpeg -c copy`.

A tier that produces a silent file is held aside rather than returned, in case a
later tier has sound. If **every** tier comes back silent, that is treated as
evidence the clip was genuinely posted without audio, and the file is kept.
Telling someone to re-pull a video that never had sound is a nag that can never
be satisfied.

> **Instagram needs the cookie jar.** The anonymous tier is rate-limited from
> most IPs. Connect Instagram in Settings so tier 0 can use the session
> (`data/yt_cookies.txt`, ADR-012). Without it, downloads fall to the sniffer.

### The mirror: a download with sound and no pictures

The opposite failure, and it is not symmetrical with the one above. A photo post
can have a song attached the way a reel has a soundtrack. The page then puts
exactly ONE progressive stream on the wire, the song, so "download the media on
this page" succeeds and hands back an `.mp4` holding a single audio stream and no
pictures at all. `derive_memo_type` reads the extension first, so the post is
filed under Videos with a song where the video should be, and it is
self-sustaining: the memo is now a video, so the next re-pull goes looking again.

`_reject_pictureless` refuses that file at **every** video tier (sniffer,
Instagram API, yt-dlp), the same place `_playable_container` and
`_has_audio_stream` already sit. It raises `PicturelessDownload`, which is a
`LocalizeError` so the tier ladder falls through unchanged, but a distinct class
because the memo layer has to tell two things apart:

- a download that **failed**: the post is a video we could not reach, the memo
  stays a video, a red error chip is honest.
- a download that **succeeded and proved the post is not a video**: there is
  nothing to retry, a red chip is a lie, and leaving the memo typed `video` is
  what sends the downloader after the same song next time. The memo is filed by
  what it holds instead, `image` when a cover survived and `link` when nothing
  did.

Unlike the silent-video count this one has no innocent reading, so the UI may say
"repair these" without ever nagging about something that cannot be fixed.

> **Audio conversions are never gated.** "Make it local -> audio" is supposed to
> produce a file with no pictures, and Spotify and Apple tracks return before
> `localize_media` is reached at all. The check only runs for `mode="video"`.

### Fixing videos already in your library

Re-pull the memo from its own page (`POST /api/memos/:id/repull`). It re-resolves
the post, downloads again through the ladder above, and rebuilds the cover. The
old file is left in place until the new one lands, so a failed re-pull costs
nothing.

Since 3.14.0 the re-resolve step runs for **every** host. It used to be gated on
instagram.com, which quietly made re-pull mean "re-download the file" everywhere
else. The download is also skipped when the source has no media stream to fetch,
so re-pulling an article or a shopping link repairs its title and cover instead of
parking a "No video formats found" error on it.

Since 3.19.0 you do not have to find the broken memo yourself. The hourly
integrity check counts two wrong-pull signatures and Settings, under Data safety,
offers to repair them:

| Signature | What it means | Certainty |
| --- | --- | --- |
| `pictureless_videos` | typed video, file holds no picture stream | no innocent reading |
| `degraded_reads` | `resolve_tier == "scope:page"`, the read never narrowed to the post | likely missing a gallery |

`POST /api/maintenance/repull-wrong-pulls` is the endpoint behind the button. It
is `dry_run=true` by default and the `degraded` half is opt-in, because that one
can queue hundreds of browser renders. Anything holding music is skipped
outright: `resolve_tier` is written by the ORIGINAL save and survives a later
conversion to audio, so a TikTok link you turned into a song still carries the
tier that would otherwise select it.

Settings → Library integrity reports a `silent_videos` count. It is a number to
look at, not an alarm: it cannot tell a broken download from a clip that was
posted muted.

---

## Graceful fallback

Memos that do not satisfy `canMakeLocal()` (articles, links, images, etc.) never
see the panel.  They have their own appropriate actions:

- **article / link** — "Open Original" button + extracted content view.
- **image** — local file preview with theater / fullscreen / lightbox.
- **note** — editable Markdown body.
- **document / code / file** — DocReportCard + "Download original" button.

No memo type is a dead end.

## The music relay (Apple Music and Spotify)

Those two are not yt-dlp jobs. A link resolves to a track, the track resolves to
an ISRC, and the lossless FLAC comes from a shared community relay ported from
[spotbye/SpotiFLAC](https://github.com/spotbye/SpotiFLAC) in
`backend/core/spotiflac.py`. No account, no Spotify token.

**It is off by default.** The relay is run by someone else, so openMemo does not
use it until you say so: Settings → Files → Music relay. While it is off, every
relay route and both music-link routes answer 404 and the download path refuses
before it builds a request, so nothing is sent to the relay at all — not even a
request that gets turned away. The switch is enforced on the server, so a
background job pulling a saved Spotify link hits the same gate. Music you add
yourself, and every other source, work regardless.

Once it is on: since August 2026 the relay only answers **verified** clients. A verification is
a challenge you complete in a browser: Settings → Files → Music relay → Verify
opens it, you finish it, the relay sends your browser back to openMemo, and
openMemo trades the grant for a session it stores locally. After that every
request is signed with the session secret, which never leaves the machine and is
never returned by openMemo's own API.

Without a session, Apple Music and Spotify pulls fail with a message saying to
verify. Nothing else is affected.

### When it breaks again

The relay's hostnames and its verification endpoint are AES-256-GCM encrypted in
upstream's binary, and they rotate. In August 2026 they moved from `-foss` to
`-oss`, which surfaced as a DNS error on every music download.

To re-derive them, take `backend/community_endpoints.go` from upstream: the key
is SHA-256 over the concatenated `communityURLSeedParts`, the AAD is
`communityURLAAD`, and each endpoint is a nonce / ciphertext / tag triple.
`backend/community_session.go` carries the bootstrap, exchange and signing
scheme, which `backend/core/music_relay.py` mirrors.
