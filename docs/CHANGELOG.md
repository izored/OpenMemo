# Changelog

All notable changes to OpenMemo are documented here.

---
## [2.0.3] - Unreleased

Video memos from every platform — not just YouTube — now play inline and wear
their source brand on the card. A saved Instagram, TikTok, Vimeo or Facebook
video used to show a generic icon and a dead "No preview available"; it now
embeds the real player and shows the platform logo.

### Added

- 🎬 **Inline players for every video platform** — the memo detail page and the dashboard lightbox now embed the source player for YouTube, Vimeo, Instagram, TikTok, X, Facebook, Dailymotion, Streamable and Twitch. Driven by a single platform registry (`frontend/src/lib/platforms.ts`) shared by the card, lightbox and detail so they never drift apart. Hosts with no embeddable player fall back to "Open original" instead of a dead end.
- 🏷️ **Brand glyphs on video cards** — Instagram, TikTok, X, Facebook, Threads, Reddit, Dailymotion and Twitch links show their platform logo on the minimal video card; any other remote host shows its favicon; only true local uploads fall back to the generic video icon.
- ✅ **Platform embed test matrix** — `frontend/src/lib/platforms.test.ts` locks embed-URL + glyph behavior across 12+ hosts, including graceful nulls for unknown / embed-less hosts and local files.

### Changed

- 🧩 **Video platform detection centralized** — the YouTube-only `videoSource()` / `youtubeEmbed()` helpers in `lib/media.ts` were replaced by the shared `lib/platforms.ts` registry consumed by `MemoCard`, `Lightbox` and `MemoDetail`. Adding a new host now lights up all three at once.

### Fixed

- 📺 **Non-YouTube video embeds** — Instagram (and Vimeo, TikTok, Facebook, …) video memos showed no inline player: a dead "No preview available" in the lightbox and only a "Make it local" panel on the detail page. They now embed the source player the way YouTube always did.
- 🏷️ **Generic glyph on social video cards** — an Instagram / TikTok / Threads video card showed a generic "video file" icon instead of its platform logo on the minimal card pill.

---
## [2.0.2] - 2026-06-01

Audio memos pulled from yt-dlp platforms now behave like first-class audio: they
download automatically, show their cover art on the card, and play from a real
player instead of a confusing "Make it local" prompt with a Video button.

### Added

- 🎧 **Auto-download pulled audio** — paste a SoundCloud / Bandcamp / Mixcloud link and openMemo downloads the audio in the background on save, so it lands as a local, playable audio memo with no manual step. Survives the original being taken down. New `Auto-download pulled audio` toggle under Settings → Uploads.
- 📻 **Stream embed for remote audio** — when auto-download is off, the memo detail streams the track inline via the platform's embed widget (SoundCloud/Mixcloud), with "Open original" and "Save audio in openMemo" actions, instead of the make-it-local panel.
- 🖼️ **Cover art on audio cards + player** — audio memos with artwork now show the cover on the dashboard card and beside the detail player, instead of always falling back to the waveform.

### Changed

- 🎵 **"Make it local" is audio-only for audio sources** — audio-only platforms no longer offer a nonsensical "Video" download option; they get a single "Save audio" action.
- ▶️ **Remote audio is reachable from the dashboard** — the audio card play button is no longer a dead disabled control for not-yet-downloaded tracks; it opens the detail page where the track streams or finishes downloading.

### Fixed

- 🪟 **Lightbox toolbar spacing** — the "Open memo page" and close buttons no longer crowd the viewport edge or each other, and the button label no longer clips.
- 🗑️ **MemoDetail delete confirm sizing** — the inline "Delete memo?" popover is more compact (smaller label and buttons), and a duplicated CSS block for it was removed.

---
## [2.0.1] - 2026-06-01

A polish pass on top of 2.0.0. Smaller scope, but every item is something you
probably ran into on day one. The MemoDetail page can scroll again, the Settings
"What's New" modal scrolls cleanly without dragging the page behind it, deleting a
memo no longer feels like a one-way door, and a "Make it local" download finally
keeps the YouTube thumbnail instead of replacing it with a random ffmpeg frame.

### Added

- 🗑️ **Soft delete with 5-second undo** — deleting a memo now slides a toast in at the bottom-center with **Undo** and a live countdown bar. Hit Undo and the card pops back. Backed by new `is_deleted` + `deleted_at` columns on `memos` and new `POST /api/memos/{id}/restore` + `GET /api/memos/deleted/list` endpoints.
- ♻️ **Recently Deleted modal in Settings** — a new "Trash" card under Settings opens a scrollable modal of recently deleted memos with one-click **Restore**. Native wheel-stop on the modal root so Lenis can't intercept the scroll (same fix as the changelog modal).
- 🪟 **Full-bleed in-card delete confirm** — clicking the × on a card now darkens that card edge-to-edge with a frosted overlay and a "Delete memo? Cancel / Delete" prompt that respects the card's rounded corners. Confirm triggers the soft delete + undo toast.
- 🗑️ **Delete in MemoDetail header** — a small trash button top-right of the memo detail header opens an inline confirm popover, deletes, and navigates back.
- 🎬 **Video description & transcript tabs** — video Memos now show two tabs on the detail page: "Video description" (the platform's own text, pulled by yt-dlp) and "Transcript" (your local Whisper text). The transcript tab only fills in once you actually transcribe, so a YouTube description never masquerades as a transcript again.

### Changed

- 🎞️ **"Make it local" keeps the source thumbnail** — yt-dlp now reports the source thumbnail URL during a localize, and openMemo caches that instead of overwriting the memo's thumbnail with an ffmpeg frame. The dashboard card keeps showing the YouTube/Vimeo poster after the video is downloaded. ffmpeg frame remains a fallback only when neither memo nor source has a thumbnail.
- 📺 **Transcript is a collapsed toggle by default** — audio and video memo transcripts no longer dump the full text inline. The "Transcript" header is now a chevron toggle; click to expand. Keeps long video pages short until you ask for the text.
- 🔝 **MemoDetail header layout** — the back arrow moves to the top-left of the header where you expect it; the memo type label moves into the content area above the title.
- 🛠️ **Dev `npm run dev` proxies to Docker by default** — `vite.config.ts` default `apiTarget` is now `http://localhost:8091` (Docker/nginx, always running) instead of `:8099` (local uvicorn). Override with `VITE_API_TARGET` when running `dev.ps1`.
- 🌐 **One video extractor for every site** — the separate YouTube and social-video code paths are gone, replaced by a single yt-dlp path that handles all 1000+ sites yt-dlp supports. Vimeo, Dailymotion, Rumble, Bilibili and the rest now extract exactly the way YouTube does.
- 🎵 **Audio platforms save as audio** — links from SoundCloud, Bandcamp and Mixcloud are detected as audio-only (via yt-dlp's codec info) and filed as audio Memos instead of video.
- 🗂️ **Video description stored separately** — a new `video_description` column keeps the platform's text apart from `content_text`, which is now reserved for the real transcript. A migration backfills existing video Memos.
- 🎙️ **Transcript is always opt-in** — "Make it local" no longer has a combined "Audio + transcript" mode. Download audio or video, then transcribe on demand with the Transcribe button. Recordings still offer transcription at capture time.

### Fixed

- 📜 **MemoDetail scroll works again** — long memo pages were unscrollable since 2.0.0. The `om-main-inner` wrapper inside `<main>` had no height, so `om-detail-scroll`'s `flex: 1` resolved to zero. One CSS rule (`.om-main:has(.om-detail-page) .om-main-inner { height: 100% }`) restores the chain.
- 📜 **"What's New" modal scrolls correctly on long releases** — 2.0.0's release notes overflowed and clipped at the viewport edges. The modal now uses `max-height: calc(100vh - 80px)` with a flex layout and an internal `overflow-y: auto` body, and a native (non-React) wheel listener on the modal root stops Lenis from hijacking the wheel and scrolling the Settings page behind it.
- 🏷️ **YouTube description no longer mislabeled as a transcript** — video Memos were showing the pulled platform description under a "Transcript" heading even when nothing had been transcribed. The transcript view now renders only real Whisper output (when `transcript_status` is done).

---
## [2.0.0] - 2026-06-01

The biggest release yet, by a wide margin. This is months of work and fine-tuning
landing at once, and it gets openMemo a lot closer to what it was meant to be from
the start. Almost every part of the app got touched: capture, storage, the card
grid, search, the detail page, settings, the whole look. Dozens of fixes too, the
kind that turn a rough build into something that feels finished.

Audio is the headline. openMemo now records, plays, and reads back sound. Capture a
voice memo straight from your mic. Drop in any audio file, lossless WAV and FLAC
included. Play it all from a header mini-player that follows you across the app and
keeps going while you move between pages, with a waveform that reacts to the sound
as it plays.

And then it transcribes. This is the part I am most proud of. Every recording and
every uploaded file gets turned into clean, searchable text by faster-whisper,
running entirely on your own machine, in dozens of languages, on your GPU or your
CPU. No cloud, no API key, no per-minute bill. A voice memo becomes something you
can search, read back, and ask questions about, exactly like the rest of your
Memos. Speech-to-text that good, fully local and free, is the feature I wanted in
openMemo more than any other.

Make it local is the other big one. Point it at any video or audio link yt-dlp can
fetch, from YouTube and Vimeo to podcast hosts and direct media files, and openMemo
pulls the media down and keeps it, so a Memo survives the original being taken
offline.

The minimal card mode is the one I am proudest of on the design side. It is a full
redesign: cards drop their text and go full-bleed thumbnail, images detect their own
orientation and switch aspect ratio, and on hover the thumbnail blurs in place under
a soft tint while the title, tags, and source pill surface. Quiet at rest, alive on
hover. This is the openMemo I pictured when I started, and it is finally on screen.

The light and dark theme switch is the other piece I keep coming back to. It is a
cinematic sunrise and sunset: an opaque glow grows from the horizon, sunrise lifting
from the bottom going light, dusk rolling down from the top going dark, fully
covering the cards as it sweeps so the theme flips hidden underneath and is revealed
as the glow fades. I have not seen this transition anywhere else on the web, and I
am genuinely proud of it.

Around those: pin Memos and collections to the sidebar, a profile with your name
and avatar, thumbnails for uploaded videos, upload limits you control with no real
ceiling, far better saving of social and bot-walled links, drag a card onto a
collection to file it, and drag to reorder your filter tabs. This is a 2.0 because
it is not one feature, it is the release where the whole thing grew up.

A note on the look: bento-grid web design kept inspiring me through this one,
apps like Letterly and plenty of others. More to come on that front soon.

### Added

- 🎙️ **Voice recording in the New Memo panel** — the Voice tab now records from the mic (native `MediaRecorder` + WebAudio level meter, preview + re-record before saving) and uploads as an audio memo. No third-party dependency. New `VoiceRecorder` component; picks the best container the browser supports (WebM/Opus, Ogg/Opus, or MP4/AAC).
- 🔊 **Persistent header audio player** — a mini-player pinned top-right (`HeaderAudioPlayer`, driven by a single shared `<audio>` in an `AudioPlayerProvider` mounted in `<Layout>`) keeps playing across navigation and stays visible when paused. Scrub, elapsed/total time, click the title to open the memo, close to dismiss.
- 🎧 **Audio cards & inline detail player** — dashboard audio cards get a real play/pause control wired to the shared player; the memo detail page shows an inline player (scrubber, time, download). Lossless WAV/FLAC play natively.
- 📝 **Local transcription (speech-to-text)** — `faster-whisper` transcribes recordings (toggle in the Voice tab, **on by default**) and uploaded audio (on-demand **Transcribe** button on the memo page). Multilingual with automatic language detection; auto-detects CUDA (float16) and falls back to CPU (int8). The transcript is stored as the memo's `content_text`, so audio becomes **searchable and chattable via RAG**, and is rendered under the player. New module `backend/core/transcribe.py`; lazy-loaded so the app boots even without the package.
- 🎵 **Explicit Audio uploader** — the Media panel adds an Audio kind (`accept="audio/*"`); `/api/ingest/file` gains `type_override` (pins a `.webm` recording as audio, not video) and `transcribe` flags. `/api/memos/{id}/file` now serves a correct `audio/*` MIME (incl. FLAC/Opus/WebM) so browsers play and seek. New nullable `transcript_status` / `transcript_lang` columns on `memos` (auto-migrated on startup); new dep `faster-whisper`.
- 📺 **Platform logos on minimal video cards** (ENTRY OPNMMO-0006) — the bottom-left pill on a minimal-mode video card now shows the source platform's brand glyph: the YouTube logo (red) for YouTube links, the Vimeo logo (blue) for Vimeo, and the generic video icon for local uploads or other hosts. New fill-based `BRAND_PATHS` in `Icon` (kept separate from the stroke-based icon set) and a `videoSource()` detector in `lib/media.ts`.
- 💾 **"Make it local" — download any video or audio link so it survives deletion** — any Memo backed by a URL that yt-dlp can fetch (YouTube, Vimeo, social video, podcast hosts, direct media files, and the long list of sites yt-dlp supports) now gets a "Make it local" panel on its detail page. Pick a mode — **Video** (up to 1080p mp4), **Audio only**, or **Audio + transcript** (downloads audio then runs faster-whisper) — and yt-dlp pulls the media into `files/`, flipping the Memo to a local video or audio that plays and seeks even if the original is taken down. Backend: `POST /api/memos/{id}/localize` + `localize_memo_task` (new `backend/core/localize_media.py`); new nullable `localize_status` column (auto-migrated); a video thumbnail is generated after download. The page polls until the download finishes. Verified end-to-end: a YouTube link → `done`, Memo flips to local audio, served with `audio/mp4` + `206` Range.
- 🎚️ **Live waveform on audio cards while playing** — the dashboard audio card's waveform is now a `<canvas>` that animates the real frequency spectrum from the shared player's WebAudio `AnalyserNode` while that track plays (calm static bars otherwise). The `AudioPlayerProvider` builds the analyser graph once per `<audio>` (a `MediaElementSource` can only be created once) and exposes `getLevels()`; bars paint in `currentColor` so they stay theme- + accent-aware.
- 🗣️ **Transcribe local videos too** — the transcribe path now accepts local **video** memos, not just audio (faster-whisper reads the video container and pulls the audio track itself). A localized or uploaded video shows the Transcript section + on-demand Transcribe button like audio memos do.
- 🧲 **Drag a memo card onto a sidebar collection to file it** — dragging any card and dropping it on a collection in the sidebar now adds the memo to that collection. Previously the drop target existed but never fired because the grid's `DndContext` and the sidebar lived in separate providers. The `DndContext` was lifted to `<Layout>` (wrapping both the sidebar and the routed page) with a small ref "bus" (`lib/dndBus.ts`) so the active grid registers its drag handlers into the shared context. Card click + drag-to-reorder behaviour is unchanged (`PointerSensor` `distance: 8` preserved).
- 🧹 **Background memo-type sorter (runs on startup + twice weekly)** — a scheduled job re-files every memo to its canonical type so the database stays tidy. `backend/core/classify.py:derive_memo_type` is the single source of truth: uploaded file → type by extension; YouTube / social-video URL → `video`; direct image/pdf/etc. link → `image`/`document`/…; any other web page → `link`; text-only → `note`. `reclassify_all` rewrites only mismatches (idempotent). Wired via APScheduler in the FastAPI lifespan: once on boot, then Mon & Thu 03:00. Manual trigger: `POST /api/maintenance/reclassify-types` (`?dry_run=true` to preview).
- 🎴 **Minimal card mode — complete redesign with full-bleed thumbnails + hover overlays** — opt-in `cardStyle: 'minimal'` in Appearance (renamed from `min`). Image/video/link cards lose their text body in favour of a full-bleed thumbnail. Image cards auto-detect orientation on `onLoad` (`naturalHeight > naturalWidth` → `data-orient="portrait"`) and switch between `aspect-ratio: 3/4` (portrait) and `4/3` (landscape). On hover, the thumbnail itself blurs in place (`filter: blur(12px)` with `transform: scale(1.10)`, scale runs 1.8s + blur 0.7s for a subtle parallax feel). A theme-aware gradient veil fades over the blurred image — cream gradient in light, dark vignette in `[data-theme="hi"]`. Description text floats around the action cluster via `::before { float: right; shape-outside: inset(0); }`, so it wraps naturally then flows full-width below. Tags sit bottom-right on the same row as the always-visible domain pill (bottom-left).
- 🎯 **Always-visible affordance pills (minimal mode)** — link cards show a `[favicon] domain.com` pill bottom-left (with `rootDomain()` stripping `www.` + paths). Image/video/audio cards show an icon-only pill (just the type icon) that expands left-to-right on hover via `max-width: 0 → 220px` + `padding-left: 0 → 6px` (300ms ease) to reveal the title. Icon has `flex-shrink: 0` so it never compresses during the reveal animation.
- 🏷️ **Integrated action cluster (arrow + pin + delete)** — all three actions live in a single `.om-card-actions` flex row, hover-revealed top-right, styled identically (`.om-action` token: `rgba(20,20,22,0.72)` bg, `backdrop-filter: blur(12px)`, 30×30, 8px radius). New `onOpen` prop on `<Chrome>` renders the arrow as the first action when supplied — wired on note/image/video/doc/file/link cards. The old `.om-drag` grip handle is gone (DnD still works — listeners spread on the card root via `dragHandleProps`). Notes stack the actions vertically (`flex-direction: column`) so they don't sit on top of the title.
- 🖼️ **Click-to-lightbox for image + video cards (both card styles)** — clicking an image card opens a fullscreen lightbox with the image; clicking a video card opens an HTML5 `<video controls autoPlay>` for local files or a YouTube `<iframe>` embed for `youtube.com/watch?v=…` / `youtu.be/…` URLs (detected by `youtubeEmbed()` helper). Lightbox toolbar gets an "Open memo page" pill (`.om-lightbox-open`, arrow icon + text) alongside the close X — navigates to the detail page. Esc closes; click-backdrop closes. Lightbox left edge offset by `var(--sidebar-w)` (76px collapsed / 260px expanded, set on `:root` by a `useEffect` in `<Sidebar>`) so the sidebar stays visible.
- 🤖 **Headless AI ingestion endpoint** — `POST /api/ingest/ai` accepts pre-structured JSON (type, title, content, source_url, source_domain, tags[], collection_id, …) for local AI agents feeding cards into OpenMemo. Unlike `/url` (extracts) and `/extension` (DOM scrape), the caller is the AI so all metadata is pre-supplied — endpoint just persists + runs the embedding task in the background. Returns `{id, title, type, status, tags}`.
- 🎚️ **Background image blur slider** — Appearance panel gains a 0–120px range slider when `bgMode === 'image'`, wired to `Tweaks.bgBlur` (default 64). Drives `--bg-blur` CSS var; `[data-bg="image"] .om-app::before` and the dark-theme override both use `filter: blur(var(--bg-blur, 64px))` instead of a hardcoded 64px.
- 🛡️ **Branded delete confirm modal** — replaces the browser-native `confirm()` on memo delete with a centred `.om-confirm-overlay` (`z-index: 250`, backdrop blur). Card-styled `.om-confirm` panel uses surface tokens, accent typography, red Delete button + grey Cancel. Esc dismisses, click-backdrop cancels, Delete auto-focused.
- 🔁 **Video thumbnail backfill endpoint** — `POST /api/maintenance/backfill-video-thumbs` re-runs `extract_video_thumbnail` for every video memo missing a thumbnail (skips when ffmpeg isn't on PATH → 503). Idempotent; returns `{processed, skipped_existing, failed, total_videos}`. For videos that uploaded before ffmpeg was installed or whose extraction silently failed.
- ⬅️➡️ **Lightbox prev/next navigation across the grid** (ENTRY OPNMMO-0002) — opening any image/video card's lightbox now lets you page through every other media memo in the grid without closing it. On-screen chevron arrows (left/right), `←`/`→` arrow keys, a wrap-around `n / total` counter, and `Esc` to close. The lightbox was promoted from a per-card local component to a single shared grid-level overlay driven by a Zustand slice (`lightboxGroup` / `lightboxIndex` + `openLightbox`/`closeLightbox`/`lightboxStep`), rendered once in `<Layout>`. `MemoGrid` passes the ordered image/video memos as the navigable group.
- 📄 **Memodoc detail report card** (ENTRY OPNMMO-0004) — document, code, and generic `file` memos (which often have little or no extracted text, leaving the detail page a bare title) now lead with a report card: a kind badge (file extension), title, and a stat grid showing Added date, Kind, Length (word count + reading time, when text exists), Collections, Tags, and AI-summary status. Sits above the pin / generate-summary / download action row.


- 🎞️ **Local video preview + media controls in MemoDetail** — image and local video memos now share a `MediaPreview` component with three affordances: a hover-revealed Theater toggle (top-right) that expands the preview to full content width, a Fullscreen button (browser native fullscreen API), and click-to-Lightbox on images (Esc or click-outside closes). Local-file videos (`type: video` with a `file_path`) finally render at all — previously only YouTube embeds did.


- 🗂️ **Accept any file type** — the upload handler no longer enforces an extension allow-list or magic-byte gate (images are still sanity-checked). Files are categorized into image/audio/video/document/code/file; unknown types become `file` and show a file icon + extension badge on the card.
- 💻 **Code file handling** — source/script files are detected as a `code` memo type, stored as text and rendered as a fenced, language-tagged code block. Hardened comment + read-only handling guarantees uploaded files are never executed/interpreted.
- ⚙️ **Configurable max upload size** — new `GET/PUT /api/settings` (JSON-persisted) and a Settings → Uploads card to set the per-file limit (default 5 GB; user can raise it up to 1 TB or set `0` for effectively uncapped — this is a local-first app, the user owns the disk).
- 🛟 **Huge-upload disclaimer** — Add Memo's file picker now warns before sending anything ≥ 1 GiB: total size, that ingestion and embedding will take a while, and a reminder that files stay on the user's machine. One-click confirm/cancel.
- 🧪 **Unknown extension passthrough** — Uploading a file with an extension (or no extension) the categorizer has never seen still succeeds end-to-end: the original extension is preserved on disk, the memo is created with `type: "file"`, and the background processor no longer tries to UTF-8 read a binary blob (e.g. `.blend`, `.3mf`, archives) — `content_text` stays empty for true binaries instead of being polluted with replacement characters. Known-text extensions (`.txt`, `.csv`, `.log`, `.tsv`, `.srt`, `.vtt`) still get read.
- 🌐 **Local copies of extracted web content** — saved articles/links now download their referenced images into `files/extracted/<memo_id>/` and rewrite the Markdown to a local `/api/files/extracted/...` route, so memos survive the source being deleted. Runs automatically on new URL/extension ingests; a Settings → Uploads "Localize" button backfills existing memos. Served with a path-traversal-guarded route registered before the catch-all.
- 📌 **Pin from card hover (memos + collections)** — pinning is no longer detail-only. MemoCard grows a pin button left of delete in `om-card-actions`; pinned cards keep the accent button visible permanently. CollectionsPage cover gains an `.om-coll-pin` button at top-left, mirroring the same accent treatment. Both flows invalidate `['memos','pinned']` and `['collections']` query keys, so the Sidebar's Pinned section refreshes instantly.
- 🎬 **Video upload thumbnails** — new `backend/core/video.py:extract_video_thumbnail` shells out to ffmpeg (`-ss 1.0 -frames:v 1 -vf scale=480:-2 -q:v 4`) to grab a still frame from any uploaded video. Falls back to frame 0 for clips shorter than a second. Best-effort: when ffmpeg isn't on PATH the video memo simply renders without a thumb (no error). Wired into the existing `process_file_memo` background task.
- 👤 **Profile editing — name, avatar, email, mailing list opt-in** — `app_settings.json` gains `display_name`, `email`, `avatar_data_url`, `mailing_list_consent`; `SettingsPatch` accepts them via the existing `PUT /api/settings`. New Profile SettingCard at the top of the left column with an avatar picker (resized client-side to a 256² JPEG data URL so the JSON stays small), inline name/email inputs that save on blur, and an opt-in checkbox for the creator's personal updates list. Sidebar foot now reads `display_name` + `avatar_data_url` via React Query (`['settings']`), falling back to "openMemo" / initials when unset.
- 🌌 **Living-cell intro animation** — the welcome screen's single placeholder orb is replaced by four blurred blobs on independent 14/17/19/22s loops with `mix-blend-mode: screen` and `filter: blur(28px)`. Calm, slow, centred. Honours `prefers-reduced-motion`.
- 🌊 **Smooth scroll (Framer-style)** — Lenis 1.3 is wired into `.om-main` with a 1.1s exp-out easing curve. New `.om-main-inner` wrapper holds the scroll content. CSS imported from `lenis/dist/lenis.css`.


### Changed

- 🔊 **Audio play button unified with the video play button** — the dashboard audio card's play/pause control now reuses the shared `.om-play` token (same white circle, dark icon, size, shadow, and hover-scale as the video card) instead of a divergent accent-colored button. The `pause` glyph was reshaped into fillable bars so it renders under `fill` like `play`. One source of truth for the round play affordance across audio + video, both card styles.
- 🎛️ **Media-kind selector is a 2×2 grid** — with the new Audio kind, the New Memo → Media "Kind" selector (Image / Video / Audio / File) now lays out as a 2×2 grid (`.om-add-segment.grid-2x2`) instead of squeezing four items into one row.
- 🎵 **Audio waveform tile is theme-aware** — the dashboard audio card's waveform paints in `currentColor` (dim text at rest, accent-mixed when playing) so it reads correctly in both themes, instead of the baked-in white pixels that vanished on the light surface. (Superseded mid-release by the live `<canvas>` waveform above.)
- ⬆️ **yt-dlp now self-updates on container start (no longer hard-pinned)** — the image previously pinned `yt-dlp==2024.8.6`, which goes stale fast (YouTube breaks old builds every few weeks) and made "Make it local" / YouTube ingest fail with "Video unavailable". `requirements.txt` now floor-pins (`yt-dlp>=2025.1.0`) and the backend Dockerfile entrypoint runs `pip install --upgrade yt-dlp` on start (best-effort; skipped offline or via `YTDLP_AUTOUPDATE=0`), so it tracks the latest release without an image rebuild.
- 🙂 **Sidebar collection emoji no longer washed out** — the right-side emoji inherited `--text-4` (32% dim) at 10.5px, so text-presentation glyphs (🖥️ ☀️ …) looked faint. Split into a dedicated `.om-coll-emoji` span at full opacity, larger (14px), with a color-emoji font stack and a hover scale.
- 🌅 **Theme transition rebuilt — opaque sunrise/sunset reveal** — the swap is now an opaque radial glow that grows from the horizon (sunrise from the bottom, nightfall from the top) and fully covers the background blobs as it climbs. The theme flips underneath the cover (hidden), then the glow fades out to reveal the new theme. Replaces the old see-through overlay that let blobs bleed through. Built from a `clip-path: circle()` growth on an inner element with `filter: blur()` on the outer wrapper (separate elements — blur on the clipped element leaves a hard edge). Glow takes a light tint from the user's accent colour. All timing/blur/radius values live in committed `frontend/src/lib/transitionConfig.ts`, persisted to localStorage. The `theme-transitioning` `!important` colour-crossfade override is scoped to a short window so it no longer freezes Framer Motion card animations.
- 🪟 **Card style: `hybrid` → `normal`, `Min` → `Minimal`** — `Tweaks.cardStyle: 'minimal' | 'hybrid'` becomes `'minimal' | 'normal'`. Default `DEFAULT_TWEAKS.cardStyle` is now `'normal'`. AppearancePanel labels read `Normal | Minimal` (Normal first). Migration in `appStore.loadTweaks()` converts both `'rich'` and `'hybrid'` from localStorage → `'normal'` on load. All CSS selectors `[data-card="hybrid"]` → `[data-card="normal"]`; swatch class `.s-hybrid` → `.s-normal`.
- 🌿 **Sidebar active-state — no more left edge bar** — dropped `.om-nav-item.active::before` (2×14px accent strip) and `.om-coll.active`'s `box-shadow: inset 2px 0 0 var(--accent)`. Active state now reads purely as `background: var(--surface-2)` + `color: var(--text)` — cleaner.
- 🗣️ **Voice tab — explicit "coming soon" notice** — `AddMemoPanel` voice tab now leads with a prominent `.om-add-coming-soon` callout (`surface-3` bg, mic icon, "Voice capture is not yet available" + "planned for a future release"). The decorative waveform + Record button stay below at 35% opacity / `pointer-events: none` as a visual preview.
- 📁 **File/doc minimal card surface** — `[data-card="minimal"] .om-card-doc` now uses `var(--bg-rail)` (matches sidebar tint, follows theme changes) with a visible `--border-2` stroke instead of disappearing into the dashboard background. File-icon SVG (`.om-file-svg`) reduced 60% → 42% width / 140 → 98px max. Card scales down 5% on hover for a subtle press-in feel.
- 🎵 **Audio card minimal — waveform tile + play button stub** — audio memos in minimal mode now show a decorative waveform SVG background and a frosted-glass play button that fades in on hover. Play button is a visual stub (no JS wiring yet); full inline audio playback is planned as a future feature.
- 🌈 **Hover overlay redesigned — flat frosted tint (link + video cards)** — replaced the gradient-from-top veil with a flat accent-tinted tint scoped to the two card types that have blur and description (`om-card-link`, `om-card-video`). Light theme: white base tinted with the user's accent. Dark theme: dark base tinted with the user's accent. Text colour flips with the tint (dark on light, white on dark) — readable against any thumbnail regardless of image content. Image, audio, note, and doc cards are untouched.
- 📥 **Bulk local import hardened (Media panel)** — selecting or dropping multiple images/videos/files already worked, but one failed file aborted the whole batch and there was no progress. Now each file uploads independently (continue-on-error), a live `Uploading n / total…` counter shows in the dropzone + button, and partial successes still refresh the grid while reporting which files failed. Dropzone copy updated to plural ("select multiple").
- 🔀 **Drag to reorder the dashboard filter tabs** — the filter selector (All / Notes / Links / …) is now drag-sortable; the order persists per browser (`openmemo_filter_order` in localStorage via the `filterOrder` store slice). Uses a nested `DndContext` (separate from the card/collection drag context) with `distance: 8` so plain clicks still select a filter. Saved order is reconciled with the current tab set on load — new tabs (e.g. Code/Audio) append, removed ids drop.
- 🗂️ **Code and Audio are now their own filter tabs** — the dashboard selector gains `Code` (uploaded source files — own memo type, not text notes) and `Audio` tabs. Files tab narrows to real documents + generic uploads (`document,file`). Sets up a future in-app code viewer/editor (see roadmap backlog).
- 🔗 **Saved web pages are now filed as `link`, not `article`** — the Links filter tab matches `type === 'link'`, but `extract_url` (and the extension/AI ingest paths) stored most pages as `article`, so saved links never appeared under Links. Web pages now classify as `link` at save time (`extract_url`, `/url`, `/extension` all run the canonical classifier `derive_memo_type`), and the background sorter migrates existing `article` memos to `link`. There is no longer an `article` type in the taxonomy.
- ⚙️ **Settings — swapped "Made by" and "Uploads/Limits" sections** (ENTRY OPNMMO-0003) — the creator "Made by" card moves to the left column (after Library & Storage), and the Uploads/Limits card moves to the right column (after Local AI, before Built with).
- 🧩 **Lightbox is now a single shared component** — the duplicated per-card lightbox markup (image + video, with YouTube embed / local `<video>` handling) was consolidated into one `<Lightbox>` reading the shared store. `mediaSrc` / `youtubeEmbed` extracted to `frontend/src/lib/media.ts` and reused by both `MemoCard` and `Lightbox`.


- 🌅 **Theme toggle — cinematic sunset/sunrise transition** — replaces the fullscreen `z-index: 9999` overlay with a `z-index: 0` layer that sits BEHIND the cards. Going dark: midnight-blue night falls from the top (`rgba(25,55,140)` center). Going light: warm amber dawn rises from the bottom. Overlay is deliberately under all UI (sidebar, cards stay accessible during animation). Theme data-attribute flip is delayed 100ms so the overlay has a head start before CSS vars change. All UI elements crossfade over 3s via `.om-app.theme-transitioning *` scoped transitions. Background blobs are hidden during the 12s animation window and fade back in after. Documented as a design decision in `docs/memo-card-visual-system.md`.
- 🧭 **First-time tour now gates progress on a real `+` click** — the `Capture anything` step disables Next until the user actually opens the add-memo panel. The coach layer becomes `pointer-events: none` while gated so the FAB receives the click; the card buttons keep `pointer-events: auto`. Once the panel opens, the spotlight smoothly morphs from the FAB onto the panel via existing `transition: all .25s`. New `TourStep` fields: `gate`, `morphTarget`, `gateBody`.
- 🎨 **AppearancePanel — slimmer, sidebar-aware, opens on the LEFT** — the panel is now anchored on the left side of the canvas, with the horizontal offset wired to the sidebar width (260px expanded / 76px collapsed) via a compound `.om-add-panel.om-ap-panel` selector and an `.om-app.sidebar-collapsed` ancestor rule. Dropped the `1×` animation-speed button (default bumped to `2×`) and the `Rich` card-style option (the related `[data-card="rich"]` CSS is also gone). The remaining cardStyle options use the `.two` segment modifier so Min + Hybrid fill the row evenly. Existing localStorage values for `blobSpeed: 1` and `cardStyle: 'rich'` are migrated to `2` and `'hybrid'` on load.
- 🌀 **Background blob animation ~3× more visible** — `@keyframes omIridescent` rebuilt: translate amplitude ±6–7%, rotate ±6–7°, scale up to 1.18, with five keyframes instead of four. Default speed change to `2×` pairs with this so motion is actually felt without being distracting.
- 🪪 **Sidebar wordmark only — logomark dropped** — removed the small `O` avatar from the sidebar header. `.om-brand-name` size bumped 15 → 19px so the wordmark carries the slot on its own.
- 🎨 **Contrast-aware accent text colour** — new `--accent-text` CSS var derived from accent luminance (light accents → dark text, dark accents → white). Install-extension button and other accent-painted controls now read from it instead of hardcoding `#fff`, fixing invisible text on the light-grey accent. Computed in `applyTweaks` via a new exported `luminance(hex)` helper.
- 🧬 **Settings layout polish** — Profile card lives at the top of the left column. Built-with hover panel now keeps the last hovered description after `mouseleave` (no clear) and locks `min-height: 112px` so neighbouring cards don't shift. Danger zone is nested under Built-with in the right column.
- 🔃 **Single, recency-driven sort order** — dropped the four sort modes (Recent / Oldest / Title / Custom) from the dashboard and the appStore. There is one sort, always: `desc(recency_at)`. New `memos.recency_at` TIMESTAMP column with a migration that backfills from `created_at`. Drag-to-reorder writes `recency_at = NOW − (i × 1s)` per card; a brand-new memo created later still lands on top because its `recency_at = NOW()` is greater than every rewritten value. New `PUT /api/memos/{id}/recency` replaces the old `/sort` endpoint; the frontend `sortMode` state, `SortMode` type, sort dropdown UI, and `memoApi.updateSort` are all gone.


- ❤️ **Settings "Built with" card rebuilt with intent** — lead paragraph now thanks the OSS authors openly; tiles still link to each project but on hover/focus a single description slot below the grid updates with a one-line "what it does" + a "Learn more →" link out, instead of every tile being a blank pill. Expanded the entry list (added MDXEditor, yt-dlp) and gave every entry a real description. Moved the Creator card *above* the Built-with card so the "Made by" attribution leads, and equalised the footer divider's vertical space (24 px above + 24 px below the rule instead of 28 px / 8 px) so the divider sits symmetrically.


- 🧹 **Phase out Tailwind** — documented in `CLAUDE.md`: Tailwind's `dark:` variant is incompatible with the `[data-theme]` theme system; components using Tailwind classes should be migrated to the `om-*` token system on sight.
- 🛠️ **Local dev one-command startup** — `dev.ps1` starts uvicorn on `:8099` in its own terminal then launches `npm run dev` with the proxy pointed at it; no Docker required for raw dev. `DATABASE_URL` and `CHROMA_PERSIST_DIR` are now absolute paths anchored to the project root so the wrong DB is never created regardless of which directory uvicorn starts from. Vite proxy target is configurable via `VITE_API_TARGET` env var (now defaults to `:8099` for local dev; Docker users can override to `:8091`).


- 🔀 **Sidebar settings button toggles home ↔ settings** — clicking the foot button while already on `/settings` now navigates to `/` (home) instead of reloading settings. Title attribute reflects current action.
- ✨ **Appearance CTA stronger visual hierarchy** — "Open live preview" button in Settings now has an accent-tinted background (`color-mix(accent 8%, surface-2)`) and an accent-weighted border instead of blending into the surface. The arrow button is accent-filled by default (not just on hover) so it reads as the primary action in the card.
- 🎴 **Minimal mode applies to Collections page** — collection cards in minimal mode use full-bleed cover (`aspect-ratio: 4/3`, cover fills face absolutely), body text hidden at rest and overlays at the bottom on hover (dark gradient + white text). Stack fan-out on hover is preserved. Consistent with minimal image-card language.


- 🧩 **Chrome extension version bump to 1.8.6** — version synced with app. Options page now shows port hint: Docker `:8091` / dev server `:8099`.

---

### Fixed

- 👁️ **Audio play buttons + progress bars invisible in light mode** — the header mini-player, the memo-detail player, and the dashboard audio-card play button all filled with `var(--accent)`. The accent is user-customizable to any color (incl. the near-white swatch), so on a light surface the controls vanished. All audio play/pause buttons and progress fills now use the text/bg inversion (`var(--text)` on `var(--bg)`), which always contrasts the surface — dark in light mode, light in dark — regardless of the chosen accent.
- 🖱️ **Page unscrollable after navigating back from a memo** — opening a note/file (or any) memo and returning to the dashboard left the page frozen — no scroll until a full refresh. Two parts: (1) `<main>` carries `key={location.pathname}`, so React mounts a fresh scroll node on every route change, but the Lenis smooth-scroll effect had `[]` deps and never rebound (old Lenis stuck on the detached node, new node had no driver) — the effect now depends on `location.pathname`; (2) on the memo detail page, scrolling happens on an inner native-overflow pane while `.om-main` is `overflow:hidden`, so Lenis (which hijacks the wheel globally) starved the inner scroll — Lenis is now skipped entirely on `/memo/*` routes. Both the dashboard-return scroll and the detail-page scroll now work without a refresh.
- 🌅 **Theme transition: background blobs twitched just before the sunrise** (ENTRY OPNMMO-0007) — with motion enabled, the blurred background orbs visibly bumped in opacity/position a split second before the radial sunrise/sunset began. The blob lives on `.om-app::before`, which the transition-window `*` color-crossfade rule never matched (pseudo-elements aren't selected by `*`), so it kept its own `transition: background .7s` + drift keyframe and re-interpolated the instant `applyTweaks()` rewrote the `--bg-*` vars. `.om-app.theme-transitioning::before` now freezes both `transition` and `animation-play-state` for the transition window, so the blobs hold perfectly still until the radial covers the swap. (A separate, pre-existing specificity bug where dark-mode blobs never hide is logged as OPNMMO-0008.)
- 🎚️ **Audio/video couldn't seek — served full 200 instead of 206 Partial Content** — two compounding causes: (1) the backend's `FileResponse` did not actually honor the `Range` header on this Starlette version (returned the whole file with no `Accept-Ranges`), and (2) nginx dropped the client `Range` header before it reached the upstream. Fixed both: `get_memo_file` now parses `Range` explicitly and streams a `206` with `Content-Range` + `Accept-Ranges` (full responses also advertise `Accept-Ranges: bytes` so players show a scrubber); `nginx.conf` forwards `Range`/`If-Range` and sets `proxy_force_ranges on`. Verified end-to-end (`bytes=100-199` → `206 Content-Range: bytes 100-199/96044`), including suffix (`bytes=-500`) and open-ended (`bytes=1000-`) ranges.
- 📂 **Files tab showed nothing despite having file memos** — the Files filter tab sent `type=document`, but uploaded files are stored as `file` / `code` / `audio` (only true documents are `document`), so they never matched. The Files tab now maps to a type group (`document,file,code,audio`) and the `GET /api/memos` `type` param accepts a comma-separated list → `Memo.type IN (...)`. All file-backed memos now appear under Files.
- 🚫 **Drag-over collection showed a left-edge accent bar** — the sidebar collection drop-target highlight used `inset 2px 0 0 var(--accent)` (a colored left strip), which violates the project's no-left-edge-bar rule. Replaced with a `.om-coll.drop-over` class: full inset ring (`inset 0 0 0 1px var(--accent)`) + soft accent fill.
- 🎯 **Memo detail loading spinner not centred** — `.om-detail-loading` used `height: 100%`, which collapsed because the parent had no fixed height, pinning the spinner to the top. Switched to `min-height: 80vh` so it centres in the visible area.
- 🪟 **Header backdrop hard-flipped on theme change** — the header `::before` carried a hardcoded `rgba()` gradient wash that snapped between themes (CSS can't interpolate between two gradients). Removed the background fill, kept only `backdrop-filter: blur()`. Note: full-width layout will need a token-safe wash restored later.
- 🪞 **Lightbox covered the sidebar** — used `inset: 0` on `position: fixed`, blanketing the whole viewport. New `--sidebar-w` CSS var (set on `:root` by `<Sidebar>` based on `sidebarCollapsed` state) drives `.om-lightbox { left: var(--sidebar-w, 0) }`. Sidebar stays visible and interactive when the lightbox is open.
- ✨ **Inner halo glow on transparent minimal cards** — `.om-card-dom` (dominant-color blurred backdrop) bled through transparent minimal cards as a centred glow. Now `display: none` in minimal mode. Dark theme additionally gets a darker border (`rgba(0,0,0,0.55)` resting / `0.75` hover) so the card edge reads as a real stroke rather than a bright halo through the blur.
- 🎨 **Action buttons unified across all themes and card styles** — `.om-action` is now a single flat rule: 20×20px, charcoal frosted bg (`rgba(20,20,22,0.72)`), white icon, no `backdrop-filter`, no per-theme variants. Eliminates visual inconsistency between light and dark theme action clusters.
- 📐 **Hover overlay text aligns with action icons** — overlay `padding-top` reduced 16→12px to match action button top position (12px). Float obstacle width reduced 110→76px, height 38→26px to match the new 20×20px action cluster (was sized for old 30×30px buttons). Description text no longer cut short on the right side.
- 🌑 **Dark hover veil no longer fires on image cards** — `[data-theme="hi"] .om-min-hover` was applying a black vignette unconditionally, including over full-bleed images with no text. Scoped with `:has(.om-min-hover-desc:not(:empty))` — the same guard already used in the light theme. Image cards now show a clean full-bleed photo in both themes.
- 🧹 **Dead `data-theme="dark"` CSS aliases removed** — `:root, [data-theme="dark"]` → `:root` only. The `[data-theme="dark"] .om-filter-tab.active` rule removed. Dark theme has always rendered via `[data-theme="hi"]`; `"dark"` was never set on `<html>`. No visual change — dead selectors only.
- 🎴 **Minimal card dark hover tint was broken** — `[data-theme="hi"] [data-card="minimal"]` used a descendant combinator (space) but both attributes live on the same `<html>` element — the rule never matched. Fixed to compound selector `[data-theme="hi"][data-card="minimal"]`. Dark hover tint, border color, and text color on minimal link/video cards now correctly apply in dark mode.
- 🎬 **Video thumbnails never generated in Docker — final fix** (ENTRY OPNMMO-0005) — root cause was `ffmpeg` missing from the backend Docker image: `backend/core/video.py` shells out to it, so `ffmpeg_available()` returned `false` inside the container and every uploaded video rendered a blank card. The extraction code, classification (`.mp4`/`.mov`/… → `video`), and backfill endpoint were all already correct — only the runtime binary was absent. Added `ffmpeg` to `backend/Dockerfile`'s `apt-get install`. After rebuilding the image, `POST /api/maintenance/backfill-video-thumbs` regenerates thumbnails for already-imported videos.
- 🛠️ **Dev panel rendered in production builds** (ENTRY OPNMMO-0001) — `frontend/src/dev/` is gitignored but a Docker build context still copies it (gitignore ≠ dockerignore), so the dev panel shipped in built images. The `import.meta.glob` import and the render are now both gated on `import.meta.env.DEV`, so Vite dead-code-eliminates the panel from any production build regardless of whether the folder is present.


- 🪟 **Edit-collection modal hidden behind the FAB + add-panel** — `.om-modal-backdrop` `z-index` 60 → 80 so it sits above the FAB (60), AddMemoPanel (61), and the `.om-fab.open` close affordance (62). Modal scrim now properly covers everything underneath.
- 📌 **Pinned memos in the sidebar** — pinning is no longer collection-only. New `memos.pinned BOOLEAN DEFAULT 0` column (lightweight migration), `PUT /api/memos/{id}/pin`, `GET /api/memos/pinned/list`. The Sidebar's Pinned section now renders pinned collections **and** pinned memos in one group; clicking a pinned memo navigates straight to its detail page. MemoDetail gains a "Pin to sidebar" / "Unpin" pill in the action row. Drag-to-reorder within the Pinned section is intentionally out of scope for this commit (existing `sort_order` column orders the list; UI for manual reorder will land next).


- 🗂️ **File-memo thumbnail now bakes the extension into the icon** — previously the file card showed a generic Icon + a tiny ".pdf" label *below* the icon. Replaced with an inline SVG file shape that draws the extension as text *inside* the icon body — one component, extension passed as a prop, no per-type icon library. Adapts to the active text color via `currentColor`, auto-shrinks the font for unusual extensions (`.markdown`, `.dockerfile`), and scales crisp at any DPR. Matches the reference example the user provided.

- 🎛️ **Memo detail action buttons mismatched + touching** — "Generate AI Summary" was `om-btn-ghost om-btn-pill` (36 px tall, 10 px radius) while "Download original" was `om-btn-secondary` with a pile of inline styles (30 px tall, 8 px radius), and they had no parent gap, so they butted into each other with visibly different heights. Both now use `om-btn-ghost om-btn-pill` (same class, same metrics) inside a new layout-only `.om-detail-actions` flex row with `gap: 8px`. Removed inline styles. Sets a precedent for future MemoDetail header pills: drop them into `.om-detail-actions` and they line up with the rest.

- ✍️ **Note rendering polish (issue 10 — multiple sub-bugs)**:
  - 🎨 **Note card body rendered fluorescent on light backgrounds** — `NOTE_TINTS[3]` is the dark-bg / cream-text variant, but the JSX never set `data-tint` on the card root, so the CSS rule `[data-bg="random"] .om-card-note[data-tint="3"]` (which restores the intended dark background) never matched. The card kept the JS inline cream text *and* the random-bg-mode cream background — invisible / fluorescent. Card now sets `data-tint={tintIdx}`.
  - 💻 **Fenced code blocks with unknown languages broke the editor** — `codeMirrorPlugin.codeBlockLanguages` only listed ~22 entries; pasting fenced blocks for Kotlin, Swift, Ruby, PHP, Lua, R, Dart, Elixir, etc. either crashed or rendered as raw text. Expanded the map to cover ~50 languages + common aliases (`py`/`python`, `sh`/`bash`/`shell`, `rs`/`rust`, `kt`/`kotlin`, `cs`/`csharp`, `rb`/`ruby`, `hs`/`haskell`, `jl`/`julia`, `make`/`makefile`, `docker`/`dockerfile`, `gql`/`graphql`, `protobuf`/`proto`, etc.). Unknown tags still fall back to plain monospace instead of crashing.
  - 📋 **Pasting a long Markdown note into another note silently failed** — the paste handler called `insertMarkdown(text)` immediately, but if the wrapper element received the paste before the contenteditable had taken focus the call became a no-op. Now the handler `ref.current.focus()`s first and falls back to `getMarkdown() + '\n\n' + text → setMarkdown()` if `insertMarkdown` throws or doesn't change the document. The pasted content never disappears now.
- 📐 **Pandoc grid tables still don't render visually** — known limitation: ReactMarkdown + `remark-gfm` only parse pipe tables (`| a | b |`). Pandoc grid tables (`+---+---+`) render as plain text and would need a dedicated remark plugin (`remark-grid-tables` was evaluated but skipped to avoid a heavy dep). Use pipe tables (or the toolbar's Insert Table) until further notice.

- 🫳 **Drag-to-reorder only worked from the tiny grip icon** — `dragHandleProps.attributes` / `listeners` were bound to the corner `<span class="om-drag">` only, so the rest of the card body was a dead surface. Listeners are now spread onto the card root, so the entire thumbnail is a drag surface; PointerSensor still has `activationConstraint: { distance: 8 }`, so a simple click navigates to the memo as before — only pointerdown + movement >8px starts a drag. Added `touch-action: none` / `user-select: none` on `.om-card` (browsers were claiming pointerdown for native scroll/select on some platforms) and a `cursor: grabbing` on `:active` so the affordance is obvious.

- 🎥 **Facebook reels (and other bot-walled URLs) saved with bare-URL title + brown gradient** — yt-dlp can't extract FB reels (`No video formats found`), and when Microlink rate-limited or flaked, no further fallback ran so the memo ended up with `title = <raw URL>` and no thumbnail. Added a third extractor tier (`_fetch_og_meta`) that pulls the page directly with a browser UA and parses OpenGraph / Twitter-card / `<title>` tags — zero new dependency, no API key. When all three tiers fail, the memo description is now `"Preview unavailable — <domain> blocked metadata extraction. Open the original to view."` instead of silently rendering a placeholder gradient over a truncated URL. Playwright/Puppeteer can be added later if a major site moves to JS-only rendering, but Microlink + direct OG covers the common cases today.

- 🖼️ **Image thumbnails + MemoDetail preview broken in dev for Docker-ingested memos** — file-serving routes (`GET /api/memos/{id}/file`, `GET /api/files/{path}`) called `Path(memo.file_path).exists()` directly. A memo created inside Docker stores `file_path = /app/files/<ws>/<file>`; when the same DB is opened under the local `dev.ps1` uvicorn on Windows, that path doesn't resolve and the route 404s, leaving image cards on the fallback gradient and MemoDetail with a broken preview. New `backend/core/file_paths.resolve_memo_path()` re-anchors anything after the trailing `files` segment onto the current `settings.FILES_DIR`, so the same DB works under either runtime without a backfill step. Reverse-direction (Windows-ingested memo viewed in Docker) is handled by the same helper.

- 🎬 **"Failed to fetch" on every file upload (Docker users + mixed-stack dev)** — the Vite dev proxy defaulted to `http://localhost:8091`, which is the Dockerised nginx, whose stock `client_max_body_size 1m` rudely closed the TCP connection mid-upload for anything larger than 1 MB. Browsers surface that as `TypeError: Failed to fetch` long before the request ever reaches uvicorn, so the cause was invisible from the UI. Fixed across the stack:
  - `nginx.conf` now sets `client_max_body_size 0` and `proxy_request_buffering off`, with 1-hour proxy read/send timeouts, so the reverse proxy in Docker mode no longer caps uploads.
  - `vite.config.ts` defaults `VITE_API_TARGET` to the local uvicorn on `:8099` (matches `dev.ps1`); Docker users can still set it to `:8091` explicitly.
  - `FileUploadHandler.save()` streams to disk in 1 MiB chunks instead of `await file.read()` (which loaded the whole file into RAM), so a 30 GB upload no longer balloons the Python process by 30 GB.
  - The size cap is enforced incrementally during the stream; if exceeded, the partial file is deleted and a clean 413 returned.
  - `ingestApi.file()` in `lib/api.ts` now catches the network-level `TypeError` and converts it into a useful error message naming the body-size cap as the likely cause, instead of bubbling up "Failed to fetch".
  - Non-JSON error responses (nginx HTML pages) are now rendered as readable text.

- 🖼️ **Thumbnails never loaded (pre-existing)** — the catch-all `/api/files/{path}` route was registered before `/api/files/thumb/{name}`, so the greedy path param swallowed every thumbnail request and 404'd it; the thumb/file handlers also called a nonexistent `SafePath.serve_path()` (now `.resolve()`) which would 500. Cached thumbnails now serve correctly in cards and MemoDetail, with proper `image/webp`·`image/avif` content types.
- 🌐 **Social/bot-walled URL ingestion** — Facebook, Instagram, TikTok, Twitter/X, Reddit, Pinterest, Vimeo and Twitch URLs now route through yt-dlp for metadata + thumbnail extraction instead of a raw HTTP fetch that bots block. Pages that block server fetches (e.g. Dribbble) fall back to Microlink API for rich OG thumbnail + title, then to a minimal link memo — saving never fails with a 400/422 error. Removed the "use extension" hard block.
- 🔃 **New memos sank to the bottom** — the "Recent" sort ranked `sort_order` above `created_at`, so freshly added memos appeared last; "Recent" is now pure newest-first and manual ordering moved to the dedicated "Custom order" sort.
- 📁 **Collection on add was ignored** — all ingest endpoints (url/note/file/extension) accepted a `collection_id` but never linked it to the memo; new memos now land in the chosen collection (`api.ts file()` + AddMemoPanel now pass it through).
- 🖼️ **Uploaded images never rendered** — `memo.file_path` is an absolute path, so `/api/files/${file_path}` 404'd in cards and MemoDetail; added `GET /api/memos/{id}/file` (inline render, plus `?download=1` for original-file download) and pointed the UI at it.
- 🎨 **Markdown editor unreadable in dark mode** — `MarkdownEditor` used Tailwind `prose dark:prose-invert` + hardcoded `text-white`, but theming is `[data-theme]`-attribute based so `dark:` never matched; migrated to the token-aware `.om-prose` system and added token overrides for MDXEditor's bundled inline-code span and CodeMirror code blocks. Readable in both themes, view + edit.

- 📥 **Download original uploaded file** — MemoDetail now has a "Download original" action for any file-backed memo, served via `GET /api/memos/{id}/file?download=1` with the original filename.


- 🎨 **Minimal card hover veil too opaque on thumbnails** — light-theme gradient over blurred thumbnails (`rgba(245,242,236,…)`) peaked at 0.92 opacity, nearly washing out the image. Reduced to `0.72 / 0.32 / 0.05` (top / mid / bottom) so the blurred thumbnail bleeds through while text and tags remain readable.
- 🎨 **Minimal card action icons ignored light/dark theme** — buttons were hardcoded `color: #fff` with `rgba(255,255,255,0.18)` background, invisible on any light card. Light theme now applies dark ink buttons (`rgba(0,0,0,0.08)` bg / `rgba(0,0,0,0.75)` color) to all minimal card types; dark-tint note (`data-tint="3"`) keeps white since its background is `#2A2622`.
- 📍 **Sidebar collapsed avatar off-centre** — collapsed `.om-foot-btn` used `grid-template-columns: 44px` with no item alignment, so the 32 px avatar sat left-aligned inside the 44 px column. Added `justify-items: center`; avatar now sits exactly centred.
- 🖼️ **AVIF / HEIC / HEIF uploads rejected as "not a valid image"** — `_validate_image_magic` only knew fixed-offset magic bytes (PNG, JPEG, GIF, WEBP, BMP, TIFF). ISOBMFF-based formats (AVIF, HEIC, HEIF) carry no fixed header — their box type `ftyp` lives at bytes 4–7. Added an explicit check: `header[4:8] == b"ftyp"` passes immediately, covering all ISO Base Media File Format images.

### Removed

- 🗑️ **Retired audio-digest feature fully pruned from the source tree** — a long-disabled feature (its router was never mounted, its page never routed, its model only touched by the workspace-reset wipe) left dead code scattered across backend and frontend. All of it is now gone: the dead API router, its TTS helper (plus the archived copy), the unrouted page (plus its archived copy), the unused API client and type, the orphaned script-generation helper in `core/rag.py`, and the unused ORM model along with its lone reference in the `/api/maintenance/reset` loop. No runtime behaviour changes — verified backend imports clean and `tsc -b` passes. (Any orphaned table on existing databases is inert; nothing references it.)

### Migration notes

- localStorage `openmemo_tweaks.cardStyle === 'hybrid'` or `'rich'` is rewritten to `'normal'` the next time `loadTweaks()` runs (first page load after upgrade). No user action required.
- ffmpeg must be on `$PATH` for video thumbnails. Already installed on the Windows dev box; the Docker image bakes it in.


## [1.8.5] - 2026-05-19

### Fixed

- 🔌 **Browser extension connectivity** — added a `chrome-extension://*` CORS regex on the API and the missing `scripting` manifest permission; the popup no longer falsely reports "Is the server running?".

### Changed

- 🖼️ **Defuddle-style link extraction** — `extract_url` now reads JSON-LD schema.org images, resolves all image/link URLs absolute, strips nav/footer/ad clutter, and keeps images in the markdown so MemoDetail renders the hero and inline images.
- 🧠 **Extension extracts from the live DOM** — content script now does meta + JSON-LD + readable-content → markdown extraction in-page (works on SPA / bot-walled sites like Dribbble where a server fetch returns nothing); sends `thumbnail`/`description` to `/ingest/extension`, which only falls back to a server fetch for missing fields.

---
## [1.8.0] - 2026-05-18

### Added

- 🎨 **Full UI rebuild on a new design-token system** — introduced a cohesive, token-driven design system (`openmemo.css`, Satoshi/General Sans/Cabinet fonts, full inline icon set, appearance helpers) and rebuilt every screen against the live FastAPI backend (no mock data).
- 🧩 **Collections page** (`/collections`) — stacked-card hover fan-out, per-collection memo count + recent titles via `useQueries`, hover edit button, "New collection" card; cover uses the collection's thumbnail, else the latest memo's, else a color gradient.
- 🪟 **New-memo glass panel** — FAB-anchored capture panel with an animated-height tab morph (Link / Note / Media / Voice), wired to the ingest API.
- 🎚️ **Live Appearance panel** — theme, accent (+ two custom swatches), card style, Boxed/Full layout, grid columns, background image/random, and a master background-fade slider; all persisted and applied to `<html>` live.
- 🗂️ **Collection flyout** — the new-memo collection picker is now a separate left-side panel with a "New collection…" action, replacing the cropped in-panel popup.
- ↕️ **Sort dropdown** — Recent (default) / Oldest / Title / Custom order on the dashboard header.
- 🔍 **Command search overlay** — ⌘K opens a real search modal over any screen.
- ✍️ **Fullscreen writer** — distraction-free note composer wired to note ingest.
- 💾 **Storage stats** — `/api/stats` now reports real on-disk usage (database / files / Chroma cache / total); shown in a Settings "Storage" card with a usage bar.
- 🧷 **Browser-extension Settings card** — dedicated install / GitHub entry point.
- 🌈 **Dominant-color card backdrop** — a blurred, saturated copy of a card's preview image sits behind the surface so cards take on the resource's own colors.
- 🟡 **Sliding filter pill** — framer-motion shared-layout pill animates under the active dashboard filter.
- 🧭 **First-run onboarding** — fullscreen intro (with a swappable motion slot) + a data-driven coachmark tour; replayable from Settings.
- 💬 **Ask memo history** — left-side chat session list (new chat, resume past chats); composer is centered until the first message, then docks to the bottom.
- 🖼️ **Local thumbnail cache** — remote preview images are downloaded once on ingest and served from `/api/files/thumb/…` instead of being re-fetched every load.
- 🧹 **Maintenance endpoints** — `Clear cached previews` and `Reset workspace` are now real, guarded actions.
- 📓 **Changelog & update check** — Settings footer surfaces the version with a pulsing dot when a newer GitHub release exists; the changelog modal shows release notes + update steps.
- 🗂️ **Collections edit mode** — a top-right Edit toggle turns on per-card edit + drag-to-reorder (persisted to `sort_order`); calmer default view with no hover chrome.
- 📐 **Standard page frame** — one shared width + header rhythm across Dashboard, Collections, Settings (and future pages); a single `--page-max` token, Boxed/Full aware.
- 🧱 **Bento Settings grid** — masonry columns so cards pack upward with no dead space.

### Changed

- 🧭 **Memo detail stays a routed page** (`/memo/:id`) — the design's slide-over + backdrop blur was intentionally not adopted.
- 📐 **Layout width** — new Boxed (default, max-width) / Full toggle; sparse grids no longer stretch a lone card across the page (`.om-masonry-col` width capped).
- 🧑‍🎨 **Settings reflow** — Identity replaced by a slimmer **Creator** card (`dev.izo.red`), Danger zone laid out 3/4 with Creator at 1/4 so it no longer over-pads; Appearance link navigates home then animates the panel in.
- 🎯 **Density removed** — spacing locked to `roomy`.
- 🔤 **Menu text colour** — option/menu text stays the text colour; the accent is reserved for icons and indicators only.
- ✒️ **Brand voice pass** — name rendered as `openMemo`; "Memo/Memos" always capital M; em dashes removed from all UI copy; dropped "second brain" framing; intro / creator / settings copy rewritten to the brand voice.

### Fixed

- 🖼️ **Background image weight** — 5 MB upload ceiling + canvas downscale (≤1280px, JPEG q0.72) before persisting, so the backdrop no longer bloats local storage.
- 🧱 **Cropped collection picker** — replaced the clipped in-panel dropdown with a dedicated flyout.
- 📏 **Over-wide cards** — tightened masonry column max-width for image and text-only memos.

---
## [1.8.4] - 2026-05-19

### Added

- 🎞️ **Sidebar spring animation** — `<aside>` replaced with Framer Motion `motion.aside`; `animate={{ width }}` with `spring(stiffness: 320, damping: 32)` drives the expand/collapse. App shell switched from CSS grid to flex so the animated width propagates to the main content area.
- 📊 **Library & Storage merged card** — combined separate Library and Storage stats cards into one with a 2×2 inline-baseline stat grid (border dividers, no backgrounds) and a storage bar below.
- 🧩 **Browser extension card redesign** — two-column layout: copy + install button on the left, a CSS-drawn popup mockup on the right with a Framer Motion `whileInView` fade-up entrance.
- 🟥 **Danger zone visual differentiation** — `color-mix(in oklab, ...)` tints the card background and border a subtle red, with the eyebrow label also tinted; prevents it from blending with neutral cards.

### Changed

- 📐 **Settings grid → two flex columns** — replaced masonry with two independent `om-settings-col` flex divs so each column stacks cards with equal `gap: 16px` regardless of card height.
- ↔️ **Full-width grid alignment** — toggling "Full" layout now left-aligns the masonry grid (`--grid-margin: 0`, `max-width: none` on masonry columns) instead of centering it.
- 🔲 **Chrome extension popup rounded corners** — popup body background set to transparent; content wrapped in `.popup-root` with `border-radius: 14px` so the rounded shape is visible in the browser chrome.
- 🧹 **`om-setting-head` margin-bottom** — reduced from 14px to 1px to tighten the settings card header spacing.

---
## [1.8.2] - 2026-05-19

### Added

- 💾 **Backup & Restore** — `POST /api/backup?scope=structure` downloads a hot SQLite snapshot (memos, collections, tags, chats) as a zip; `scope=full` also bundles all uploaded files (thumbnail cache excluded). `POST /api/backup/restore` accepts the zip, disposes the SQLAlchemy pool atomically, replaces the database, and restores files for full-scope backups. Settings page gains a **Backup & Restore** card with Download buttons for each scope and a double-confirmed Restore flow.

---
## [1.8.1] - 2026-05-19

### Changed

- 🎨 **CSS cohesion — MemoDetail + AskMemoPanel → om-* design system** — migrated both components off Tailwind + `var(--color-*)` tokens onto `openmemo.css` om-* classes; theme switching (`data-theme`), accent colour changes, and density now apply to the detail view for the first time.
- 🖌️ **New om-* classes in openmemo.css** — `om-detail-page`, `om-detail-pane`, `om-detail-chat`, `om-detail-scroll`, `om-detail-title-input`, `om-tag-edit`, `om-coll-chip`, `om-ai-summary`, `om-image-memo`, `om-video-embed`, `om-web-card`, `om-code-inline`, `om-code-block`, `om-notes-section`, `om-related`, `om-related-strip`, `om-related-card`, `om-ask-panel`, `om-panel-msg`, `om-panel-bubble`, `om-citation-chip`, `om-ask-panel-composer`, `om-btn-pill`, `om-spin`, `om-accent-icon`.
- 📐 **Detail page layout fix** — `:has(.om-detail-page)` strips `om-main` padding and overflow so the two-pane flex layout fills the viewport correctly.
- 🎞️ **Entrance animation** — detail pane and chat panel slide in via `omDetailIn` keyframe, respects `prefers-reduced-motion`.

---
## [1.7.43] - 2026-05-18

### Added

- 🖱️ **Live drag-to-reorder** — cards visually swap in real time while holding and dragging, powered by `onDragOver` + synchronous `dragOrderRef` to avoid stale state.
- 🎞️ **FLIP settle animation** — on drop, framer-motion `layout` animates each card to its final position with a 250ms ease-out spring.
- ✨ **Drag lift effect** — the held card springs into a slightly scaled, rotated state using framer-motion, matching the motion.dev drag feel.
- 📋 **README overhaul** — updated copy, fixed `docs/MEMORY.md` and `docs/DESIGN.md` paths, corrected roadmap link to `Specs/ROADMAP.md`.

### Changed

- 🎯 **Collision detection → `pointerWithin`** — swap only triggers when the pointer is physically inside another card's bounds; fixes diagonal move mis-fires and cross-column jumps.
- 🏗️ **Drag architecture** — removed dnd-kit CSS transforms entirely; array order controls card positions, DragOverlay shows the floating ghost. Eliminates the transform conflict that caused infinite render loops with `rectSortingStrategy`.

### Fixed

- 💥 **`Maximum update depth exceeded` crash** — caused by `rectSortingStrategy` measuring DOM rects in a layout effect loop during rapid swaps. Reverted to `verticalListSortingStrategy`.
- 🔄 **Snap-back on drop** — `handleDragEnd` was reading stale `localMemos` closure; replaced with synchronous `dragOrderRef` that updates in the same tick as each swap.
- ↕️ **Up/down drag broken** — `closestCenter` was finding horizontally adjacent cards when dragging vertically; fixed by switching to `pointerWithin`.

---
## [1.7.42] - 2026-05-09

### Added

- 🧩 **Dashboard grid density control** — added a 4/5 memo-card layout setting in `SettingsPage.tsx` so dashboard density can be changed from Settings.
- 🧠 **Grid preference persistence** — added `dashboardGridColumns` state and setter to the app store so the chosen dashboard layout survives refreshes.
- 🧱 **Masonry dashboard support** — introduced masonry-style layout behavior for the main dashboard to better accommodate variable memo card heights.
- 🧭 **Inline BAF action** — moved the BAF/Add New action beside the search bar for faster dashboard access.
- ✍️ **Full note-detail editing flow** — the note detail editor, rendered markdown view, and toolbar improvements from the recent editor work are now part of the release history.
- 🗂️ **Settings redesign foundation** — the bento-style Settings redesign, creator/info cards, and supporting stats/settings improvements are included in this release line.

### Changed

- 🎛️ **Appearance settings flow** — placed the new dashboard grid control inside the Appearance section and refined the segmented control styling so the selected state reads clearly.
- 📐 **Dashboard layout wiring** — `MemoGrid` now reads the saved dashboard grid preference instead of relying on a hardcoded 5-column desktop layout.
- 🪄 **Header and navigation polish** — the dashboard top bar, inline controls, hamburger/header work, and homepage CSS refinements are now aligned as part of the same release stream.
- 📝 **Memo card readability** — cleaned up memo card text hierarchy for clearer scanning in the dashboard.
- ⚡ **FAB behavior** — the main Speed Dial flow now aligns better with direct note creation and inline dashboard actions.

### Removed

- 🧹 **Floating FAB wiring** — removed floating FAB usage from `Layout.tsx` along with stale related imports and unused state.
- 🚫 **Broken settings collapse pattern** — removed the inconsistent keyboard-shortcuts collapse behavior from Settings so the full shortcuts grid stays visible.

### Fixed

- ✨ **Speed dial JSX repair** — fixed the broken JSX block in `SpeedDialFAB.tsx`.
- 🫧 **Hover animation jitter** — separated parent positioning transforms from child hover scale transforms in `SpeedDialFAB.tsx` so hover animation feels stable.
- 🚫 **Duplicate store destructure error** — removed the repeated `useAppStore()` destructure that caused redeclare issues.
- 🛠️ **Store wiring for grid controls** — fixed the missing app store state/setter pair so the 4/5 dashboard buttons render and behave correctly.
- 🔎 **OP-07 selected-state diagnosis** — confirmed the settings control was rendering in the DOM and traced the missing selected state to absent store wiring rather than a visual bug.
- 📝 **Markdown paste and render pipeline** — preserved markdown syntax correctly on paste, improved fenced code block handling, and tightened rendered markdown typography.
- 🧾 **Markdown editor view-first behavior** — fixed read/view mode initialization and blur-save handling so markdown notes open and save more reliably.
- 🔄 **Late-load sync and preview snippet issues** — corrected note preview and markdown state sync issues across the note flow.
- 🔎 **Medium fetch false alarm** — confirmed the `403 Forbidden` issue comes from Medium blocking automated extraction, not from an OpenMemo regression.

### Docs

- 📘 **README and roadmap sync** — updated release-facing documentation, roadmap entries, and changelog history to match the shipped UI/editor/dashboard work.
- 🏷️ **Versioned release prep** — prepared the project history for the `v1.7.42` tag and release notes.

---

## [1.7.4] - Unreleased

### Added

- 📐 **Unified top bar** — Dashboard header is one flex row: hamburger (left) + greeting + centered filter pills + search box (right). Hamburger integrated directly in dashboard; Layout's floating hamburger hidden on `/`.
- 🖱️ **FAB cursor** — Speed Dial main button and dial items show `cursor-pointer` on hover.

### Changed

- ⚡ **FAB click** — Main Speed Dial FAB button now opens the new-note modal directly on click. Hover still opens the full dial (Note / Link / Multimedia) with ease-in animation.
- 📐 **Filter pills centered** — Type filters (All / Image / Links / Videos / Notes / Files) are centered within the header flex row.
- 🔲 **5-column memo grid** — Dashboard grid is now `grid-cols-5` at `xl` breakpoint (was 4). Gap reduced to `gap-6`.

### Fixed

- ⌨️ **Settings keyboard shortcuts** — Shortcuts grid is always visible; removed broken collapse/expand toggle that left it in an inconsistent state.
- 📝 **MarkdownEditor `viewFirst`** — `editing` state is now derived from the `viewFirst` prop instead of a fragile `useState(!viewFirst)` + sync effect. ReactMarkdown renders on load; MDXEditor opens only on user click.
- 📝 **Markdown paste + render (full fix)** — Plain-text paste now routes through `insertMarkdown()` so syntax (`#`, `**`, fenced code, tables) becomes proper nodes instead of escaped literals. Added `codeMirrorPlugin` for fenced code block rendering. Added `@tailwindcss/typography` so `prose` classes style headings/lists/blockquotes. Updated `code` component for react-markdown v10 (`inline` prop removed). Tightened note view spacing (`prose-sm` + custom margins).

---

## [1.7.3] - 2026-05-07

### Added

- 📊 **Stats card** — full-width bento card showing live memo, collection, and tag counts from `/api/stats`; by-type emoji breakdown; "added this week" counter
- 📣 **Feedback card** — "Send Feedback" mailto link pre-filled with `[OpenMemo Feedback]` subject; zero infra
- 🧩 **Chrome Extension card** — "Save from anywhere" card with View on GitHub link
- ⌨️ **Keyboard Shortcuts card** — collapsible 3-column grid showing 6 core shortcuts
- 🔴 **Danger Zone card** — Export all memos (JSON download) + disabled Clear all data with warning copy
- 👤 **Creator card** — "Made By Reda Izo" with portrait photo, bio, and 4 social link pills (izo.red, GitHub, X, Threads)
- ❤️ **Built With card** — mosaic grid of 11 open-source dependencies, each with a one-line description
- 🔖 **Version footer** — replaces About card; small O logo + `v{version}` pulled from `/api/health`
- 🗄️ **`/api/stats` endpoint** — returns `total_memos`, `total_collections`, `total_tags`, `memos_this_week`, `by_type` breakdown

### Changed

- 📐 Settings page layout switched from single-column sections to a **2-column bento grid**
- 📐 Appearance + Ollama cards are now side-by-side
- 📐 Feedback + Chrome Extension cards are now side-by-side
- 📐 Creator (Made By) + Built With cards are now side-by-side at the bottom

---

## [1.7.2] - 2026-05-07

### Fixed

- 📐 Sidebar now pushes content (flex layout) instead of overlaying — responsive, no overlap
- 📐 Removed `backdrop-blur` from sidebar backdrop — cleaner dim effect on main content only
- 📐 Hamburger button fades out when sidebar is open (close button lives inside sidebar header)
- ⚡ Drag-and-drop card reorder is instant — optimistic local state updates immediately, API fires in background
- 🗄️ Ollama embed model fallback now distinguishes endpoint-404 from model-404 — prevents cascading fallback to removed `/api/embeddings` route
- 🗄️ `EMBED_MODEL` correctly wired into `docker-compose.yml` environment — was only in `backend/.env` which Docker ignores
- 🗄️ `/api/models` filters out embed/bert-family models — only chat models appear in the dropdown
- 🗄️ AskMemo stream error handling — Ollama exceptions yield SSE error event instead of silently closing the connection
- 🗄️ AskMemo checks `resp.ok` before reading stream — surfaces HTTP errors clearly
- 🎨 Model picker auto-selects first available Ollama model on load — no more hardcoded `qwen2.5:7b` default
- 🎨 Selected chat model persists to `localStorage` across sessions

---

## [1.7.1] - 2026-05-06

### Added

- 🎨 Centralized CSS token system in `index.css` with light/dark variants
- 🎨 All hardcoded `#hex`, `rgb()`, `bg-white`, `bg-[#...]` Tailwind values replaced with `var(--color-*)` tokens
- 🎨 Added type-specific dark tokens: `--color-type-{note,article,video,image,audio,document,link}-{bg,text}`
- 🎨 Scrollbar colors use CSS variables
- 🎨 `::selection` dark mode override
- 🎨 Dark mode auto-application on load disabled — manual toggle only until fully polished
- 🧱 `<PageBox>` — `rounded-2xl` container with `var(--color-bg-card)` and dark mode baked in
- 🧱 `<BackButton>` — reusable brand-colored back navigation
- 🧱 `<Card>` — generic card base with consistent padding, radius, shadow, and dark mode
- ⚡ `transitions.css` with named durations: `--transition-fast: 150ms`, `--transition-base: 280ms ease-out`, `--transition-slow: 400ms ease-out`
- ⚡ `--ease-out`, `--ease-in-out`, `--ease-spring` tokens
- ⚡ Sidebar slide: `320ms` with `cubic-bezier(0.16, 1, 0.3, 1)` easing
- ⚡ Hamburger fade-in delay: `450ms` after sidebar closes
- 🗄️ `BaseService` generic class with `get()`, `get_or_404()`, `list()`, `create()`, `update()`, `delete()`
- 🗄️ `MemoService`: `list_by_workspace()`, `create_memo()`, `update_memo()` with safe relation replacement
- 🔒 `backend/core/security/sanitize.py` — unified input sanitization (`sanitize_workspace_id`, `sanitize_filename`, `escape_fts5_query`, `validate_url`, `sanitize_string`, `SafePath`)
- 🔒 `backend/core/security/upload.py` — `FileUploadHandler` with size limits, extension whitelist, magic byte validation, UUID-based filenames
- 📝 Installed `@mdxeditor/editor`
- 📝 `<MarkdownEditor>` component with plugins: headings, lists, quotes, thematic breaks, markdown shortcuts, bold/italic/underline toolbar
- 📝 Note-type memos: inline markdown editor in `MemoDetail` (click to edit, auto-save on blur)
- 🙏 SettingsPage "Built With" section listing open-source dependencies
- 🙏 README.md "Credits & Open Source" section

### Changed

- 🎨 Removed `bgColor` from Zustand store — background now pure CSS-driven
- 📐 Standardized inner content padding — no arbitrary `p-3`, `p-7` scattered around
- 📐 `AskMemoPage`: `rounded-2xl overflow-hidden` containers
- 📐 Back button moved above title in `MemoDetail`, inline style
- 🔍 Removed `Ctrl+K` kbd badge from search input
- 🔍 Placeholder text: `"Search memos…  Ctrl+K"`
- 🎴 Note cards show `content_raw` as fallback preview when `content_text` is empty
- ⬆️ `vite` 8.0.10 → 7.3.2 (bundler regression fix)
- ⬆️ `@vitejs/plugin-react` 6.0.1 → 4.7.0 (Vite 7 compatibility)

### Fixed

- 🐛 **Fixed `Prism is not defined` fatal error** — Vite 8's Rolldown bundler wrapped `prismjs` in an IIFE, scoping `var Prism` locally. `@lexical/code` referenced bare `Prism` as a free variable, causing a `ReferenceError` that killed the entire JS bundle before React could mount. Downgraded `vite` to 7.3.2 and `@vitejs/plugin-react` to 4.7.0 to restore Rollup-based bundling
- 🐛 **Fixed Ollama `/api/embed` 404 on older versions** — Added automatic fallback from modern `/api/embed` to legacy `/api/embeddings` endpoint in `ollama_client.py`. `embed()` and `embed_batch()` both retry with the legacy endpoint on 404
- 🐛 **Fixed memo sort 422 error** — `PUT /api/memos/{id}/sort` expected `sort_order` as a query parameter, but the frontend sent it in the JSON body. Changed the endpoint to accept a `SortUpdate` Pydantic model from the request body
- 🎨 **Removed all blur effects** — Removed `backdrop-blur-sm` from `MemoCard.tsx` drag handle per user preference (no blur anywhere)
- 🔒 All 13 API endpoints now use `sanitize_workspace_id()`
- 🔒 `ingest.py` refactored: removed inline sanitization, uses shared module
- 🔒 `main.py` `serve_file()` uses `SafePath.serve_path()`
- 🔒 `fts5.py` deduplicated: imports `escape_fts5_query` from `sanitize.py`

---

## [1.7.0] - 2026-05-05

### Open-Source Readiness

- **GitHub community files** — Added `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/FUNDING.yml`, and `.github/labels.yml`
- **Community standards** — New `CONTRIBUTING.md` (setup, style, PR workflow), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (reporting + scope), and `SUPPORT.md` (help channels + FAQ)
- **CI skeleton** — Backend test infrastructure (`pytest`, `pytest-asyncio`, `httpx`) in `backend/tests/`. Frontend test deps (`vitest`, `@testing-library/react`) added to `package.json`
- **Documentation** — New `docs/architecture.md`, `docs/deployment.md`, and `docs/faq.md`
- **EditorConfig** — Added `.editorconfig` for consistent cross-editor formatting

### Added

- **Inline memo editing** — MemoDetail page now supports inline editing for title, source URL, tags, collections, content, and notes. Toggle edit mode with the pencil icon
- **User notes / annotations** — Every memo has a private `notes` field (textarea, auto-saved) that is included in embeddings for RAG retrieval
- **Sortable drag & drop** — Memo cards can be reordered within the grid via `@dnd-kit/sortable`. New `PUT /api/memos/{id}/sort` endpoint with `sort_order` persistence
- **Rich link preview** — Article/link memos display favicon, domain, description, thumbnail, and collapsible extracted content in MemoDetail
- **Delete button on MemoCards** — Red `×` appears on hover after a 3-second delay to prevent accidental deletion
- **Dynamic version** — Settings page now shows live version from `/api/health` instead of hardcoded string
- **Rotating greeting** — Dashboard greeting cycles through 10 variations on each page refresh (was once-per-day)

### UX Polish

- **Dark mode foundation** — CSS variable system (`--color-bg-*`, `--color-text-*`) with `html.dark` overrides. Applied across Dashboard, Sidebar, Settings, Search, and Layout
- **Flash-of-light-mode fix** — Inline script in `index.html` applies `dark` class before React hydrates, eliminating FOUC
- **Prominent drag handles** — Grip icon now has dark `bg-[#202020]/80` with `backdrop-blur-sm` for visibility on any card background
- **Ctrl+K search positioning** — Fixed absolute positioning so it no longer overlaps the grid on short viewports
- **Back button styling** — MemoDetail back arrow matches brand color and has hover state

### Infrastructure

- **Environment-driven config** — Removed all hardcoded personal paths/domains. `docker-compose.yml` is clean; local overrides go in `docker-compose.override.yml` (gitignored)
- **Chrome extension config** — API URL is now configurable via an options page (`options.html`) reading from `chrome.storage.sync`. Default: `http://localhost:8091/api`
- **CORS override** — `CORS_ORIGINS` accepts comma-separated env var override for custom domains
- **Demo data seeding** — `seed_data.py` generates 19 rich memos across 4 collections for fresh installs

### Fixed

- **`update_memo()` MissingGreenlet crash** — Replaced async `.clear()` with synchronous `= []` on pre-loaded relationships via `selectinload`
- **`update_memo()` collections/tags persistence** — Collections and tags are now properly replaced on update (not just appended)
- **Hamburger visibility** — Toggle button now visible on all pages including Settings and MemoDetail

---

## [1.6.6] - 2026-05-05

### Security

- **Path traversal fix** — `workspace_id` in file uploads is now sanitized (whitelist `a-zA-Z0-9_-`) preventing `../../` attacks
- **File upload validation** — Max 50MB limit, magic-byte content validation, rejected executable types
- **Secure file serving** — `/files/` static mount replaced with `/api/files/:path` endpoint that verifies memo ownership before serving
- **FTS5 query escaping** — User search terms are escaped before passing to SQLite FTS5 `MATCH`, preventing syntax errors and injection

### Fixed

- **Card detail navigation** — ALL card types now navigate to `/memo/:id` detail view with an "Open Original" button for external links (previously video/link/article cards bypassed detail)
- **`@general` RAG bypass** — Fixed `lstrip("@general")` bug that was stripping individual characters instead of the substring
- **Memo update collections/tags** — `update_memo()` now properly persists `collection_ids` and `tags` changes
- **YouTube subtitle extraction** — Transcript result is now used as `content_text` instead of being discarded
- **Search silent failures** — Exceptions in hybrid search are now logged instead of silently swallowed
- **Chat history over-fetch** — Replaced `.all()[-6:]` with `.order_by(...).limit(6)` SQL-level pagination
- **Async blocking I/O** — ChromaDB operations, PDF parsing, DOCX parsing, image reading, and yt-dlp subprocess now run in threadpool/async subprocess
- **Chrome extension error handling** — Added `response.ok` check before streaming

### Changed

- **Inline search bar** — Replaced centered `SearchModal` popup with a real search input in the Dashboard header. Type directly, see dropdown results, `Ctrl+K` to focus, `Escape` to clear
- **Dedicated Docker port** — Default access URL changed from `localhost:80` to `localhost:8091`. No hosts file or port conflicts needed
- **Removed dead UI** — Hidden Voice tab, Share/Tag/More buttons in MemoDetail until implemented

---

## [1.6.5] - 2026-05-05

### Sidebar & Navigation

- **Push sidebar layout** — Sidebar is now a true flex push layout (`width: 0 ↔ 240px`) instead of an absolute overlay. Main content shrinks naturally when sidebar opens. Removed `backdrop-blur-sm` overlay entirely.
- **Global hamburger menu** — Moved the sidebar toggle from Dashboard to `Layout.tsx` so it's accessible on **all pages** (Dashboard, AskMemo, MemoDetail, Settings).

### Collections Enhancement

- **Collection emoji & description** — Collections now support an emoji icon (default 📁) and an optional description. Backend schema updated with `emoji` and `description` columns.
- **Collection creation modal** — New modal for creating collections with name, emoji picker, description textarea, and color swatches. Reached via the "+" button in the sidebar Collections section.
- **Collection quick edit** — Hovering a collection in the sidebar reveals a pencil icon. Clicking it opens the same modal pre-filled for updating.
- **Sidebar collection display** — Collections now render as `emoji + title` instead of folder icon + name.

### Memo Cards

- **Note card body preview** — Note cards now show `content_text` (the actual body) as the primary preview, falling back to `description` only when body is empty.
- **Drag & drop into collections** — Memo cards are now draggable (grip handle appears on hover). Drop a card onto any sidebar collection to add it. Droppable targets highlight in red on hover. Powered by `@dnd-kit/core`.

### Tooling & Repo

- **`.claude/` added to `.gitignore`** — Keeps Claude local config (skills, plugins, settings) out of the repository while preserving it locally.

---

## [1.6.0] - 2026-05-05

### Infrastructure & Reliability

- **Multi-host Ollama fallback** — `OLLAMA_HOSTS` env var supports comma-separated fallback endpoints. The backend automatically tries localhost, Docker Desktop bridge (`host.docker.internal`), and GPU nodes (`ollama_gpu0`, `ollama_gpu1`) until one responds. Working host is cached for 30s to avoid repeated health checks.
- **Docker Compose fully completed to spec** — Added the missing `nginx` reverse proxy service on port 80 that the v1.5 spec described but was never implemented. API and web containers now use `expose` instead of `ports` — only nginx is publicly accessible.
- **Healthchecks & startup ordering** — `openmemo-api` has an HTTP healthcheck on `/api/health`. `openmemo-web` waits for `service_healthy` before starting, eliminating race conditions where nginx proxies to a still-booting backend.
- **Linux Docker compatibility** — Added `extra_hosts: ["host.docker.internal:host-gateway"]` for native Linux Docker setups where `host.docker.internal` does not resolve by default.
- **Expanded CORS origins** — Added `http://127.0.0.1:3000`, `http://localhost:80`, and `http://localhost` to prevent CORS rejections when accessing via alternate origins.

### AI & Search

- **Vision model updated** — Default vision model changed from `llava:13b` to `gemma3:4b` (smaller, faster, better availability).
- **FTS5 full-text search implemented** — The spec claimed hybrid search (semantic + FTS5) existed, but the code only used `ilike` substring matching. Now properly implements:
  - SQLite FTS5 virtual table (`memos_fts`) with auto-sync triggers
  - Dedicated `backend/api/search.py` router
  - Graceful fallback to `ilike` if FTS5 is unavailable
  - FTS5 index auto-rebuilds on first run

### Design

- **Replicate-inspired design system** — Complete frontend visual overhaul based on the [Replicate DESIGN.md](https://getdesign.md/replicate/design-md) (clean white canvas, code-forward aesthetic):
  - **Color:** Brand accent shifted from amber `#D97706` to Replicate Red `#ea2804`. Primary text is now `#202020` (near-black) on pure white.
  - **Typography:** Added `Inter` for body text and `JetBrains Mono` for code/technical elements via Google Fonts.
  - **Shapes:** Pill-shaped geometry (`rounded-full`) for badges, tags, buttons, active states, and icons.
  - **Buttons:** Primary CTAs are dark solid (`#202020` bg, white text) with `rounded-full`. Secondary actions use outlined pills.
  - **Code blocks:** Dark `#24292e` background with JetBrains Mono, matching GitHub's code aesthetic.
  - **Links:** Dotted underline decoration (Replicate signature pattern) for external/source links.
  - **Borders:** Subtle `#e5e5e5` borders that darken to `#202020` on hover for interactive cards.
  - **Components updated:** Sidebar, Dashboard, MemoCard, MemoGrid, MemoDetail, AskMemoPage, AskMemoPanel, AddMemoModal, SearchModal, Layout.

### Documentation

- **New `docs/INSTALL.md`** — Comprehensive installation and troubleshooting guide covering:
  - Development vs Docker production modes
  - Ollama endpoint configuration matrix (native / Docker Desktop / Linux / GPU nodes)
  - Troubleshooting matrix for 8 common issues
  - Windows-specific notes (PowerShell, WSL2)
- **New `docs/CHANGELOG.md`** — This file. Versioning starts at 1.6.0.
- **Updated `README.md`** — Reflects new Docker architecture, multi-host Ollama, design overhaul, and points to full install guide.

### Tooling

- **Impeccable skill installed** at `.claude/skills/impeccable/SKILL.md` — Design quality commands (`/impeccable audit`, `/impeccable polish`, `/impeccable critique`, etc.) and anti-pattern rules for ongoing UI improvements.
- **Replicate `DESIGN.md`** dropped at project root — Design system document that AI coding agents can read for consistent UI generation.

---

## [1.5.0] - 2026-05-05 (Original Release)

### Added

- Streaming SSE for chat — replaces WebSocket proposal from v1.0 spec
- Background task queue for embeddings — ingestion returns 202 Accepted immediately
- Hybrid search at API level — ChromaDB semantic + SQLite full-text merged & re-ranked
- `@` prefix RAG bypass — general knowledge fallback without vector retrieval
- File-type routing in ingestion pipeline — MIME/extension dispatch to correct extractor
- Docker-compose with nginx reverse proxy (spec only — not fully implemented until 1.6.0)
- TypeScript throughout frontend — strict mode, 0 `tsc` errors

---

## Versioning Notes

- **1.5.0** was the original as-built spec release.
- **1.6.0** is the first properly versioned release after addressing all spec-to-code gaps, infrastructure fixes, and the design overhaul.
- Future releases will follow semver: `MAJOR.MINOR.PATCH`.
