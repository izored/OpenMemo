# Audio Memo Handbook

_The reference for how audio works in openMemo: what ships today, why I built it
this way, and where it goes next. Update this whenever the audio stack changes._

_Introduced in 2.0.0 (the audio release). Last updated: 2026-06-05._

---

## 1. What audio memos are

An audio memo is a first-class Memo type (`type: "audio"`) backed by a media file
on disk. It can arrive three ways:

1. **Recorded** in the New Memo panel's Voice tab (mic → WebM/Opus/MP4 container).
2. **Uploaded** as a file (MP3, WAV, FLAC, M4A, OGG, Opus, AAC, and more).
3. **Localized** from a remote link via "Make it local" (yt-dlp pulls the audio).

Once it exists, an audio memo can be played anywhere in the app through one shared
player, and optionally transcribed to searchable text that lives in the memo's
`content_text` (so it embeds into RAG like any other Memo).

---

## 2. Architecture at a glance

```
Capture
  ├─ Record  → VoiceRecorder.tsx (MediaRecorder)  ─┐
  ├─ Upload  → AddMemoPanel (Audio kind)           ─┤→ POST /api/ingest/file
  └─ Localize→ MakeItLocalPanel (MemoDetail)        ─┘   (type_override, transcribe)
                                                         POST /api/memos/{id}/localize

Store
  └─ files/<workspace>/<uuid>.<ext>   +   memos row (file_path, type=audio)

Serve
  └─ GET /api/memos/{id}/file   → audio/* MIME + HTTP Range (206) for seeking

Play (one shared <audio> for the whole app)
  └─ AudioPlayerProvider (lib/audioPlayer.tsx, + volume/mute), mounted in Layout
       ├─ SidebarPlayer            (now-playing in sidebar foot: small/big/collapsed, ADR-005/010)
       ├─ MemoCard music card      (inline corner-cluster player; LiveWaveform for voice, ADR-010)
       └─ MemoDetail               (MusicDetailPlayer hero for music+cover; AudioMemoPlayer bar otherwise)
            shared bits: Marquee (one-line title), VolumeControl (animated icon + slider)

Transcribe (background)
  └─ transcribe_memo_task → core/transcribe.py (faster-whisper)
       → content_text + transcript_status + transcript_lang → embed
```

### Key files

| File | Role |
|------|------|
| `frontend/src/lib/audioPlayer.tsx` | The shared player context + the single `<audio>` element (+ volume/mute) + the WebAudio analyser graph. |
| `frontend/src/components/SidebarPlayer.tsx` | Now-playing player in the sidebar foot (small / big / collapsed). |
| `frontend/src/components/MusicDetailPlayer.tsx` | Cover-forward hero player on the detail page (music + cover art). |
| `frontend/src/components/VolumeControl.tsx` | Animated speaker icon + slider; 15s self-announcing pulse, mute. |
| `frontend/src/components/Marquee.tsx` | One-line title that auto-scrolls on the active track. |
| `frontend/src/lib/coverMood.ts` | Client-side dominant-color extraction for the cover-mood tint. |
| `frontend/src/components/VoiceRecorder.tsx` | Mic capture via `MediaRecorder` + live level meter. |
| `frontend/src/components/LiveWaveform.tsx` | Canvas waveform on audio cards, driven by the analyser. |
| `backend/core/transcribe.py` | faster-whisper wrapper (lazy, threaded, device auto-detect). |
| `backend/core/localize_media.py` | yt-dlp download ("Make it local"). |
| `backend/api/ingest.py` | `ingest_file`, `transcribe_memo_task`, `localize_memo_task`. |
| `backend/api/memos.py` | File serving with Range, `/transcribe`, `/localize` endpoints. |

---

## 3. Playback: one shared `<audio>`

**Decision: there is exactly one `<audio>` element in the entire app**, owned by
`AudioPlayerProvider` and mounted in `Layout` (which never unmounts across route
changes). Every surface (the sidebar now-playing player, dashboard cards, the
detail page) drives that same element through the `useAudioPlayer()` context.

**Why:** playback has to survive navigation. Open a memo, hit back, the track keeps
playing and the sidebar player stays visible. Two competing `<audio>` elements would
fight over playback state and double up sound. One element is the single source of
truth for `playing`, `currentTime`, `duration`, and the active track.

**Consequence to respect:** never add a second `<audio>` for app audio. New surfaces
call `play()`, `toggle()`, `seek()`, `getLevels()` from the context. The detail page
probes duration with a throwaway `new Audio()` only for metadata (never for
playback).

**Volume + mute live on the same element (ADR-010).** The context exposes
`volume` (0..1, persisted to `localStorage`), `muted`, `setVolume`, and
`toggleMute`; they are written to the one shared `<audio>` and re-applied on each
track load. Every surface drives that single value, so there is no per-surface
volume: the card player, sidebar players, and OS media keys stay in sync.

### Three player surfaces (ADR-010)

Music plays through three surfaces, all driving the one shared `<audio>`:

- **`SidebarPlayer`** in the sidebar foot, in three sizes. `small` is the compact
  row (cover thumb, marquee title, transport, volume button). `big` is the
  full-bleed cover-first card: play is a large disc in the top-right corner, pin
  and repeat are satellites beside it (`.om-sb-player-sat`), the scrubber drops to
  a bottom block, and the close X sits top-left, anchored by `position:relative`
  on `.om-sb-player-big` and revealed on hover. `collapsed` shrinks to a cover
  thumbnail with a progress ring so "something is playing" survives the tucked-away
  rail.
- **The inline card player** (`CardMusicPlayer`): the active music card flips to an
  in-card player via an absolute overlay, at the card's existing size, no resize,
  no cover zoom. Same corner cluster as the `big` sidebar player. Voice cards keep
  their `LiveWaveform` instead.
- **`MusicDetailPlayer`** on the detail page: a large cover-forward hero for a
  music memo with cover art. The cover bleeds full-bleed and a left→right
  mood-gradient veil fades it into the solid cover color where the title, centered
  transport, and scrubber sit (one image plus a gradient, so there is no
  side-by-side seam). Voice and cover-less audio keep the compact `AudioMemoPlayer`
  bar.

### Volume + marquee, shared across every surface (ADR-010)

Two small components ride on all the surfaces:

- **`VolumeControl`** renders an animated speaker icon plus the title on the bottom
  row. Click the icon to mute (icon turns to ✕). Hover slides a slider out over the
  title in place, lingering ~2s after the pointer leaves so it can be grabbed. The
  resting icon pulses every 15 seconds: waves sweep 0→3→0 then settle on the count
  matching the current level (≤30% → 1 wave, ~50% → 2, high → 3), so you can tell
  which card is the one playing. Dragging the slider updates the wave count live.
- **`Marquee`** truncates a title to one line with an ellipsis at rest. On hover, if
  the text overflows, it slides left to reveal the end then returns (a single pass,
  not a loop) at a constant reading speed. On the active now-playing surfaces the
  `auto` mode loops slowly. It honors `prefers-reduced-motion`.

Full-bleed controls are white-on-cover (the scrim is always dark enough). The slider
and icon fall back to theme tokens only on the non-tinted `small` sidebar player.

### The detail hero veil and sizing (ADR-010)

The hero veil and panel width are driven by CSS vars with shipped fallbacks. A
"Gradient" tab in the existing DEV panel (`src/dev/DevPanel.tsx`) tunes them live via
`--dev-*` on `:root` (DEV-only, production untouched). Two shipped behaviors are
worth knowing:

- **Mood brightness is theme-aware and animated.** It is a `filter: brightness()` on
  the veil, 100% in light, 50% in dark, set concretely per theme (dark base `0.5`,
  `[data-theme="light"]` overrides to `1`) so the change triggers `transition:
  filter` and cross-fades instead of jumping. `filter` is on the
  `.om-app.theme-transitioning *` allow-list so the dim eases across the 3s theme
  swap. A gradient `background` can't transition; a filter can, which is why it is a
  filter.
- **Cover width follows the artwork aspect.** A 16:9 thumbnail (e.g. a localized
  YouTube track) gets an 80% panel; square art (uploaded file, SoundCloud) gets 40%.
  It is measured from the image and set per-memo via `--cover-w`, animated with
  `transition: width` so it doesn't jump between memo types. The hero holds
  `opacity: 0` until the cover has loaded and its aspect is known, then fades in, so
  the width settles while hidden and nothing pops in piecemeal.

### Music description, not a transcript (ADR-010)

A song's "transcript" is its lyrics, which need a dedicated provider (deferred, see
ADR-005). So for music (`audio_kind === 'music'`) the transcript panel is hidden. In
its place a collapsible `MusicDescription` shows the source's own notes (the YouTube
/ SoundCloud description: tracklist, timestamps, notes), which is not a transcript.
The live platform widget ("Listen on SoundCloud") gains a brand-glyph heading that
doubles as a show/hide toggle and collapses by default once the track is local.
Artist comes from the uploaded file's tags (mutagen, any format) into `audio_artist`,
shown only when a real tag exists, never the source domain, and it also feeds the OS
media metadata.

---

## 4. The live waveform

The audio card waveform is a `<canvas>` (`LiveWaveform.tsx`) that animates the real
frequency spectrum while a track plays, and shows a calm static pattern at rest.

- The analyser graph (`AudioContext` → `MediaElementSource` → `AnalyserNode` →
  destination) is built **once** on first play and kept in refs.
- **Gotcha (hard constraint):** a `MediaElementSource` can be created only once per
  `<audio>` element. A second `createMediaElementSource()` on the same element
  throws. This is why the graph lives in the provider and is guarded by a null
  check, not rebuilt per card.
- Bars paint in `currentColor`, so CSS controls the color (dim text at rest, accent
  mix when active) and it stays theme-aware for free.
- The `AudioContext` starts suspended under browser autoplay policy; it is
  `resume()`d on the user's play gesture.

---

## 5. Recording

`VoiceRecorder.tsx` uses the native `MediaRecorder` API. No third-party dependency.

- **Container pick order:** `audio/webm;codecs=opus` → `audio/webm` →
  `audio/ogg;codecs=opus` → `audio/ogg` → `audio/mp4`. Whatever the browser
  supports first. Chrome/Edge land on WebM/Opus, Firefox on Ogg/Opus, Safari on
  MP4/AAC.
- A live level meter is drawn from a WebAudio `AnalyserNode` on the mic stream
  (separate from the playback analyser; this one is decorative and torn down on
  stop).
- The finished blob is wrapped in a `File` named `Voice memo <timestamp>.<ext>` and
  handed to the panel, which uploads it.

**Decision: a recording is uploaded with `type_override=audio`.** A browser records
into a `.webm`/`.weba` container, which the extension-based categorizer would file
as **video** (WebM is a video container). The override pins it to `audio` so it
lands in the right bucket and gets the audio UI.

---

## 6. Serving + seeking (the Range story)

Audio (and video) must seek. That means the server has to answer HTTP `Range`
requests with `206 Partial Content`, not the whole file as `200`.

**Two bugs were fixed here, both worth remembering:**

1. **The backend's `FileResponse` did not honor `Range`** on the Starlette version
   in use (returned the full file, no `Accept-Ranges`). So `get_memo_file` now
   **parses `Range` explicitly** and streams a `206` with `Content-Range` +
   `Accept-Ranges`. Full responses also advertise `Accept-Ranges: bytes` so players
   render a seekable scrubber. See `_parse_range` / `_stream_file_range`.
2. **nginx dropped the client `Range` header** before it reached the backend.
   `nginx.conf` now forwards `Range` / `If-Range` and sets `proxy_force_ranges on`.

**MIME matters too.** `mimetypes.guess_type` returns `octet-stream` for `.flac`,
`.opus`, `.weba` on many systems, and the browser's `<audio>` refuses a non-audio
Content-Type. `get_memo_file` forces a correct `audio/*` type from `_AUDIO_MIME` for
audio memos (and a `.webm` recording stored as audio is served `audio/webm`, not
`video/webm`).

Verified end-to-end: `bytes=100-199` → `206 Content-Range: bytes 100-199/<size>`,
direct and through nginx, including suffix (`bytes=-500`) and open-ended
(`bytes=1000-`) ranges.

---

## 7. Transcription (the flagship)

Local speech-to-text via **faster-whisper** (`backend/core/transcribe.py`).

### Why faster-whisper (not Parakeet / NeMo)

I evaluated NVIDIA Parakeet (parakeet-tdt-0.6b). It is excellent but drags in
`nemo_toolkit` + PyTorch (~4 GB) and strongly prefers a GPU. openMemo's stack is
otherwise torch-free (embeddings go through Ollama). faster-whisper (CTranslate2) is
a light install, multilingual out of the box (~99 languages with auto-detect), and
runs acceptably on CPU. It was the right fit for a local-first, low-footprint app.
Parakeet v2 is also English-only; the multilingual v3 carries the same heavy
footprint. **Decision: faster-whisper.**

### How it runs

- **Lazy + dependency-tolerant.** The library and model load on first use, in a
  worker thread. The app boots fine even if faster-whisper is not installed; the
  transcribe path just returns an actionable error.
- **Device auto-detect.** CUDA + `float16` when a GPU is visible (via
  `ctranslate2.get_cuda_device_count()`), otherwise CPU + `int8`. If CUDA is claimed
  but the libs are missing, it falls back to CPU int8 rather than crashing.
- **Singleton model**, guarded by a load lock; a separate inference lock serializes
  transcription (a single model is not concurrency-safe).
- **VAD filter on** to skip silence.

### Where the text goes

**Decision: the transcript is stored in `memo.content_text`, not a separate field.**
That means audio is embedded into ChromaDB and becomes searchable + chattable
through the exact same RAG path as every other Memo, no special-casing downstream.
Two columns track UI state only: `transcript_status` (`pending|processing|done|
error`) and `transcript_lang` (detected language code).

### When it runs

- **Recordings:** a toggle in the Voice tab, **on by default**, sets `transcribe=
  true` on the upload. Audio + transcript is the default experience.
- **Uploaded audio:** an on-demand **Transcribe** button on the memo detail page.
- **Local videos:** the transcribe path accepts `type in (audio, video)`. faster-
  whisper reads the video container (PyAV) and pulls the audio track itself, so a
  downloaded or uploaded video can be transcribed with no manual audio extraction.
- **Remote videos (no local file):** **Get transcript** on the Transcript tab runs
  the caption-first extractor (`core/transcript.py`): host subtitles via yt-dlp,
  Whisper STT fallback, without downloading the media or changing the memo type.
  See ADR-004.

### Config (env / `backend/config.py`)

| Setting | Default | Notes |
|---------|---------|-------|
| `WHISPER_MODEL` | `small` | `tiny\|base\|small\|medium\|large-v3`. CPU sweet spot is `small`; `medium`/`large-v3` want a GPU. |
| `WHISPER_DEVICE` | `auto` | `auto\|cpu\|cuda`. |
| `WHISPER_COMPUTE_TYPE` | `auto` | `auto\|int8\|float16\|float32`. |
| `WHISPER_BEAM_SIZE` | `1` | Higher = slightly better, slower. |
| `HF_HOME` (Docker) | `/app/data/hf-cache` | Model cache on the mounted volume so it downloads once (~464 MB for `small`). |

---

## 8. "Make it local" (yt-dlp)

`MakeItLocalPanel` (detail page) + `POST /api/memos/{id}/localize` +
`localize_memo_task` + `backend/core/localize_media.py`.

Any Memo with a `source_url` yt-dlp can fetch (YouTube, Vimeo, social video, podcast
hosts, direct media files) can be pulled local. Two modes:

- **`video`:** best ≤1080p mp4 (merged video+audio).
- **`audio`:** best audio-only (m4a/opus); an **explicit** video→audio (podcast)
  conversion that replaces the video view.

On success the memo's `file_path` is set, `type` flips to local audio/video, and a
video thumbnail is generated. Status is tracked on `localize_status`; the detail page
polls until done.

> Transcripts are **not** produced here anymore. The `audio_transcript` mode was
> removed; transcript extraction is a separate, non-destructive path
> (`POST /api/memos/{id}/transcribe` → `core/transcript.py`, caption-first / STT
> fallback) that never changes `type`/`file_path`. See ADR-004.

**Decision: yt-dlp self-updates on container start, not hard-pinned.** YouTube breaks
old yt-dlp builds every few weeks, far faster than image rebuilds. `requirements.txt`
floor-pins (`yt-dlp>=2025.1.0`) and the Dockerfile entrypoint runs `pip install
--upgrade yt-dlp` on start (best-effort; skip with `YTDLP_AUTOUPDATE=0`). Recorded in
`docs/architecture.md`. A hard pin was the direct cause of a "Video unavailable"
failure during testing.

---

## 9. Data model

Columns on `memos` added for audio (all nullable, auto-migrated on startup in
`main.py` via `PRAGMA table_info` + `ALTER TABLE`):

| Column | Meaning |
|--------|---------|
| `audio_kind` | `voice\|music`, or null. Splits behavior (waveform vs cover art). See ADR-005. |
| `audio_artist` | Artist from the uploaded file's tags (mutagen, any format); null when no real tag exists. See ADR-010. |
| `transcript_status` | `pending\|processing\|done\|error`, or null. |
| `transcript_lang` | Detected language code (e.g. `en`), or null. |
| `localize_status` | `pending\|processing\|done\|error`, or null. |

The transcript text itself reuses `content_text` (+ mirrored into `content_raw`).
There is intentionally no separate transcript table.

---

## 10. Decisions log (quick reference)

| # | Decision | Why |
|---|----------|-----|
| D1 | One shared `<audio>` in a provider mounted in `Layout`. | Playback survives navigation; single source of truth; no double audio. |
| D2 | Transcript → `content_text`. | Audio becomes searchable + chattable via the existing RAG path, zero special-casing. |
| D3 | faster-whisper, not Parakeet/NeMo. | Light install, multilingual, CPU-viable; keeps the stack torch-free. |
| D4 | Transcription lazy + thread + device auto-detect. | App boots without the dep; never blocks the event loop; works GPU or CPU. |
| D5 | Recordings uploaded with `type_override=audio`. | WebM is a video container; without the override a mic memo files as video. |
| D6 | Explicit `Range`/`206` in the backend + nginx forwarding. | Framework `FileResponse` didn't honor Range; nginx dropped the header. Seeking now works. |
| D7 | Force `audio/*` MIME on serving. | `guess_type` returns octet-stream for FLAC/Opus/WebM; `<audio>` then refuses to play. |
| D8 | Play controls use `var(--text)`/`var(--bg)`, not `var(--accent)`. | Accent is user-customizable to near-white; accent-filled controls vanished in light mode. |
| D9 | Live waveform analyser built once per element. | `createMediaElementSource` throws on a second call for the same element. |
| D10 | yt-dlp self-updates on start. | YouTube breaks old builds faster than image rebuilds. |
| D11 | Volume/mute on the one shared `<audio>`, persisted; exposed via context. | Single source of truth across every player surface; no per-surface `<audio>` writes (ADR-010). |
| D12 | Full-bleed player is corner-anchored (play top-right, pin/repeat satellites, scrubber bottom) with a 15s self-announcing volume icon + one-line marquee titles. | Cover-first layout; the pulse signals which card is playing; marquee reveals long titles (ADR-010). |
| D13 | Detail page gets a cover-forward hero player (music+cover); source widget is a collapsible reference (collapsed once local); music transcript hidden pending lyrics; a togglable Description shows the source's notes (≠ transcript). | A song's "transcript" is lyrics (deferred); the YouTube/SoundCloud description still defines the content and is worth keeping (ADR-010). |
| D14 | Artist comes from the uploaded file's tags (mutagen, any format) into `audio_artist`; shown only when present, never the source domain. | "youtube.com" is not an artist; real ID3/Vorbis artist is, and it also feeds OS media metadata (ADR-010). |

---

## 11. Known limitations / current state

- **No word-level timestamps or transcript-synced playback:** the transcript is a
  single cleaned block, not time-aligned to the audio.
- **No diarization:** speakers are not separated/labeled.
- **No progress bar during transcription:** the UI shows a "transcribing…" state
  and polls, but not a percentage.
- **Transcription is serialized:** one inference lock; concurrent requests queue.
- **`small` model on CPU** is the default: fine for short clips, slow on long ones.
- **No transcript editing:** the user cannot correct the generated text yet (it is
  the memo's `content_text`, so editing the note edits the transcript, but there is
  no purpose-built transcript editor).
- **Make-it-local has no per-download progress:** only pending/processing/done.

---

## 12. Roadmap: where audio goes next (V2 ideas)

Grouped by theme. Nothing here is committed; this is the backlog to pull from.

### Playback & UI
- **Transcript-synced playback:** word/segment timestamps from faster-whisper
  (`word_timestamps=True`), click a word to seek, highlight the current word as it
  plays.
- **Playback speed control** (0.75×–2×) in the mini-player and detail player.
- **Global keyboard shortcuts:** space to play/pause the active track, arrows to
  seek, from anywhere.
- **Queue / continuous play:** play through all audio memos in a collection.
- **Real per-track waveform:** precomputed peaks for the whole file (offline
  analysis at ingest), so the scrubber shows the actual waveform, not just a live
  spectrum while playing.

### Transcription quality
- **Word-level timestamps + segments** stored alongside the text (new field or a
  sidecar), enabling sync + search-to-timestamp.
- **Speaker diarization:** separate and label speakers (e.g. pyannote, kept
  optional/heavy).
- **Transcript editor:** a dedicated editing surface that keeps timestamps intact.
- **Language pick / forced language:** let the user override auto-detect when it
  guesses wrong.
- **Summarization of long audio:** reuse the AI-summary path on the transcript.
- **Chapter detection:** split long recordings into navigable sections.

### Performance & ops
- **Progress reporting:** stream segment-by-segment progress to the UI (faster-
  whisper yields segments lazily; surface them as they arrive, even live-append the
  transcript).
- **Model size in Settings:** expose `WHISPER_MODEL` as a UI setting with a
  download-on-demand flow.
- **Batch transcription:** a maintenance endpoint to transcribe every
  un-transcribed audio/video memo.
- **GPU detection surfaced in Settings:** show the user whether they're on CUDA or
  CPU and the expected speed.

### Capture
- **Pause/resume while recording.**
- **Longer-form recording UI:** section markers, a running transcript preview.
- **Import from podcast RSS:** subscribe and auto-localize episodes.

### Make it local
- **Per-download progress** parsed from yt-dlp output.
- **Quality picker:** let the user choose resolution/format before download.
- ~~**Subtitle download**~~ *done (ADR-004):* the transcript path is now
  caption-first, pulling host subtitles via yt-dlp and only falling back to
  Whisper STT when none exist.

---

## 13. Testing notes

The audio + localize paths were verified end-to-end against the Docker stack:

- Upload audio with `transcribe=true` → memo `type=audio`, `transcript_status`
  flows `pending → processing → done`, language detected, model cached to the
  volume.
- Range: `bytes=100-199` → `206` + correct `Content-Range`, direct and via nginx;
  suffix and open-ended ranges covered.
- Make-it-local: a YouTube link → `done`, memo flips to local audio, served
  `audio/mp4` + `206`. The error path (dead/unavailable video) sets
  `localize_status=error` and surfaces a readable message.

When changing anything in this stack, re-run those checks (a tone WAV is enough to
exercise the transcription pipeline without needing speech).
