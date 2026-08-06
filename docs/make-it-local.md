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
