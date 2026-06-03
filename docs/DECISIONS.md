# Architecture & Process Decisions

Significant decisions about how OpenMemo is built and how changes are scoped.
Newest first. Each entry is an ADR (Architecture Decision Record): the context,
the decision, and its consequences, so a future reader knows *why*, not just
*what*.

---

## ADR-005 — Audio is a first-class media experience: voice vs music split, local-first pull-first player

**Date:** 2026-06-03 · **Status:** Accepted · **Builds on:** ADR-001 (whole-type scope), ADR-003 (tiered capture), ADR-004 (non-destructive transcript)

### Context

Audio was the runt of the media types. Three different things all collapsed into a
single undifferentiated `type: 'audio'`:

1. **Voice memos** — mic recordings made in-app (spoken word, transcribe-on-save).
2. **Uploaded music** — a local `.mp3` / `.flac` / `.wav` the user dropped in.
3. **Linked music** — a track pulled from SoundCloud / Bandcamp / Mixcloud / Audius.

Nothing in the schema told them apart, so every render site had to guess from a
fragile filename heuristic (`title LIKE 'Voice memo%'`). That blocked any
treatment that should apply to *music but not voice* (cover art, an album-style
player, ambient glow) or *voice but not music* (the waveform the user explicitly
loves). Playback itself was a top-right pill (`HeaderAudioPlayer`) bolted onto the
app shell, with no presence in the sidebar where the rest of the app's navigation
lives, and no way to tell what was playing once the player was dismissed.

Two latent bugs made linked audio actively hostile:

- **Bug 1 — audio hosts mistyped `video`.** SoundCloud/Bandcamp/Mixcloud live in
  the extractor's `_VIDEO_DOMAINS` (yt-dlp pulls them like any other site). When
  yt-dlp's metadata probe *failed* at save time (rate-limit, transient network, a
  momentary host change — all common for SoundCloud), `extract_video` fell back to
  a hardcoded `type = "video"`. A `video`-typed SoundCloud memo has no inline
  player (it is not in the video embed registry) and every audio render path is
  gated on `type === 'audio'`, so the detail page rendered **nothing** — a dead
  end produced by a transient hiccup, affecting *every* audio host, not one.

- **Bug 2 — the live platform embed was hidden whenever auto-download was on.**
  The SoundCloud/Mixcloud widget ("listen at the source") only rendered when
  `localize_status` was unset, i.e. auto-download OFF. With auto-download ON (the
  default), the user never got the live reference, and a `localize_status: done`
  state that somehow lacked a `file_path` fell through every branch to nothing.

### Decision

Promote audio to a first-class, deliberately designed experience, modeled on
**two orthogonal axes** so we never again conflate distinct concerns:

| Axis | Field | Drives |
|------|-------|--------|
| **Kind** | `audio_kind` ∈ {`voice`, `music`} | *Behavior* — waveform vs cover art, inline card player, ambient glow |
| **Origin** | `file_path` (local) vs `source_url` (remote) | *Playback path* — our `<audio>` engine vs platform iframe |

**1. `audio_kind` is an explicit column, set at ingest, read through one predicate.**
The mic recorder posts `audio_kind=voice`; every other audio (uploaded file or
linked pull) defaults `music`. A PRAGMA-guarded migration backfills existing rows
(`title LIKE 'Voice memo%'` and no `source_url` → `voice`, else `music`). The
frontend reads it through a single `audioKind(memo)` predicate in `lib/media.ts`
(with the same heuristic as a fallback for un-migrated rows). No scattered `if`s.

**2. The player is local-first and pull-first.** Our engine is one shared HTML5
`<audio>` element (in `AudioPlayerProvider`, survives navigation). It can only
play a real media resource the browser can load — a local file at
`/api/memos/:id/file`. Platform "embeds" (`w.soundcloud.com/player/…`) are *whole
web pages*, not streams; the real stream URLs are signed and CORS-locked, so
`<audio src>` can never point at them. Therefore **linked audio must be pulled to
a local file (yt-dlp) before our player can touch it.** Auto-download (default ON,
already wired in `ingest.py`) makes this invisible: a saved SoundCloud link
localizes in the background and *upgrades itself* into the rich player within
seconds. Until then — and whenever a host is unpullable or auto-download is off —
the platform **iframe is the graceful live-reference fallback**, never a dead end.

**3. Classification knows audio hosts (Bug 1 fix), centrally.** A single
`AUDIO_HOSTS` set (backend) is consulted by both `extract_video`'s failure
fallback and `derive_memo_type`: a known audio host classifies `audio` **even when
yt-dlp fails**. The frontend mirror is `lib/audioPlatforms.ts` — a registry of
host → brand glyph + embed URL + can-localize, exactly parallel to the video
`lib/platforms.ts` (ADR-001). Card, detail, and player all read the registry; a
new audio host is added in one place.

**4. Remote audio never dead-ends (Bug 2 fix).** The detail page always offers a
listen path for a remote audio memo: the live platform embed (when the registry
has one) plus "Make it local", independent of `localize_status`. A localized memo
plays its local file *and* still exposes the source embed as a reference.

**5. The player lives in the sidebar, and music gets the full treatment.**
`HeaderAudioPlayer` (top-right pill) is removed. A `SidebarPlayer` sits in the
sidebar foot — cover, title, subtitle, scrubber, and a transport of
**repeat-one · play/pause · pin** (the single-item focus replaces next/prev; no
queue yet). When the sidebar is collapsed it shrinks to a cover thumbnail with a
progress ring so "something is playing" survives the tuck-away. Two treatments are
**music-only** (gated on `audioKind === 'music'`), leaving voice memos exactly as
they are (waveform tile + button, which users love):

- **Inline card player** — the active music card flips to a full-bleed in-card
  player (the same overlay mechanism as the delete-confirm, `om-card-confirm`):
  blurred cover, large play/pause, scrubber.
- **Aurora glow** — a faint, slowly drifting aurora-borealis halo behind the
  playing music card, tinted from its own cover art, bleeding a little past the
  card edge, so the currently-playing memo is findable in a dense grid. Honors
  `prefers-reduced-motion`.

**6. Lyrics are explicitly deferred** (documented in the roadmap, no code).
Future work, free sources only (local-first): **LRCLIB** (open synced-lyrics API,
no key), embedded ID3 `USLT`/`SYLT` tags read from uploaded files, `lyrics.ovh`
as a plain-text fallback. No paid lyrics API, ever.

#### Scope boundary — video

The sidebar player drives the **audio engine** (music + voice). Video plays as an
iframe embed in the lightbox/detail and has no persistent surface to relocate
into the sidebar without reloading (and stopping) playback. A video "now playing"
/ picture-in-picture surface is a separate, larger build, deferred to the roadmap.
Audio ships first; video follows.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Proxy the SoundCloud Widget API** (control their iframe via postMessage) | Per-provider (Bandcamp/Mixcloud have weak/no equivalent); fragments the one-engine model into "some `<audio>`, some iframe-proxied"; no unified scrubber, no cover art, **no aurora** (it is their chrome); cross-origin postMessage is flaky. Clean beats clever; local-first wins. |
| **Split `audio` into separate `voice` and `music` memo types** | A bigger migration that breaks every `type === 'audio'` gate (`canMakeLocal`, `canTranscript`, `derive_memo_type`). A sub-kind keeps the audio type cohesive and satisfies ADR-001 (one type, provider/variant differences centralized), at far lower blast radius. |
| **Keep deriving voice vs music from the filename** | Fragile — breaks on rename, on non-English titles, on any uploaded track literally named "Voice memo…". A real column is the single source of truth. |
| **Leave the player in the header** | The sidebar is where navigation + pinned items live; a collapsed-sidebar now-playing cue is impossible from a top-right pill; and the inline-card / aurora story wants the player conceptually "inside" the library, not floating over it. |
| **Stream linked audio directly in our `<audio>`** | Impossible for the platforms that matter — their stream URLs are signed + CORS-locked. Pull-first is not a preference, it is the only correct path; auto-download hides the cost. |

### Consequences

- New column `audio_kind` (migration `backend/migrate_audio_kind.py`,
  PRAGMA-guarded ALTER + backfill). Exposed in the memo API + `Memo` TS type.
- New `lib/audioPlatforms.ts` registry; `audioEmbed` moves there. Adding a host
  (e.g. Audius) lights up card glyph + detail embed + player simultaneously.
- A transient yt-dlp failure can no longer turn a SoundCloud memo into a dead
  `video` page; audio hosts are structurally `audio`.
- Remote audio always has a listen path (live embed and/or local file) — the
  reported "play button leads to a page with nothing" is structurally impossible.
- `HeaderAudioPlayer` is deleted; `SidebarPlayer` replaces it. The shared engine
  gains repeat-one state.
- Music cards gain an inline player + aurora; voice cards are untouched.
- Repeat-one + pin replace next/prev; a real queue/playlist is future work.

---

## ADR-004 — Transcript extraction is decoupled from file capture (non-destructive, caption-first)

**Date:** 2026-06-03 · **Status:** Accepted · **Supersedes:** the transcript portion of ADR-003

### Context

ADR-003 modeled "Make it local" as a single tiered action keyed off memo type,
with three download modes: `video`, `audio`, and `audio_transcript`. In practice
this fused **three distinct user intents** into one destructive action:

1. *Get a transcript* — the user wants the **text** of a talk; audio is only a
   means to that end.
2. *Save the video offline* — keep a playable local copy.
3. *Convert a long video to an audio-only "podcast"* — deliberately drop the
   video.

Because the only transcript path was `audio_transcript`, asking for a transcript
**downloaded the audio and flipped `memo.type` from `video` to `audio`**
(`ingest.localize_memo_task`: `memo.type = result["type"]`). The inline video
embed is gated on `type === 'video' && !file_path`, so the flip silently
**destroyed the video** — the user lost their video to get its text. A transcript
is a *property* of a memo, not a memo type; coupling the two was the root error.

### Decision

**Transcript extraction is a separate, non-destructive capability that never
changes a memo's `type` or `file_path`.** It is independent of "Make it local"
(file capture). Two orthogonal axes:

- **Transcript** (`POST /memos/:id/transcribe` → `core/transcript.py`) — produce
  text only. The memo keeps its type and its remote embed.
- **Make it local** (`POST /memos/:id/localize` → `core/localize_media.py`) —
  capture a local file. `mode='audio'` remains an **explicit** video→audio
  podcast conversion (the third intent above), now clearly labeled and warned in
  the UI, never a transcript side door. The `audio_transcript` mode is removed.

#### Transcript pipeline — caption-first, STT fallback

`core/transcript.py` `get_transcript(url)`:

1. **Captions** — `yt-dlp --skip-download --write-subs --write-auto-subs
   --sub-format vtt` pulls the source's own subtitles **without downloading the
   media**. Fast, free, no Whisper. The VTT is parsed (inline word-timing tags
   stripped, rolling auto-caption duplicates de-overlapped) into text with inline
   `[mm:ss]` markers.
2. **STT fallback** — if the host exposes no captions, download the audio to a
   **temp** directory, run faster-whisper (now emitting per-segment `[mm:ss]`
   markers), then **delete the temp file**. The memo's `type`/`file_path` are
   untouched — a video memo stays a video memo.

The result is stored in `content_text` (so it embeds for RAG + is searchable),
with `transcript_source` recording `captions` vs `stt` for a UI badge. A local
file present routes to direct Whisper STT (`transcribe_memo_task`); remote-only
routes to the caption-first extractor (`transcript_memo_task`).

#### On-demand, multi-mode summary

Summaries are generated lazily per mode, each a single Ollama call fed the
**full** transcript/content (`core/rag.py` `SUMMARY_MODES`):

- **`timestamp`** — chronological bullet outline anchored to the inline `[mm:ss]`
  markers (only offered for video/audio, since it depends on those markers).
- **`insights`** — key takeaways as bullets (mirrored to `ai_summary` for
  back-compat).
- **`essay`** — flowing prose.

Results cache per-mode in the `summaries` JSON column so switching back is
instant. Inline timestamps live **in the transcript text itself** — no separate
segments table — which is what makes the timestamp mode possible without extra
storage.

#### Scope — the whole video type (ADR-001)

Both caption pull and STT run through yt-dlp, which abstracts every video host,
so this lights up for YouTube, Vimeo, Dailymotion, TikTok, etc. simultaneously.
`canTranscript(memo)` in `lib/media.ts` is the single predicate. Hosts with no
captions fall back to STT; hosts with neither (auth-walled/private) degrade to an
error state with "open original" still available — never a dead end.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Keep `audio_transcript` (download audio + flip type)** | The root bug — destroys the video to get its text and conflates three intents. |
| **Always Whisper STT, ignore host captions** | Slower and heavier for the common case; YouTube/Vimeo already publish accurate captions for free. STT is the fallback, not the default. |
| **Separate `transcript_segments` JSON column for timestamps** | More storage + a migration for data that rides for free as inline `[mm:ss]` in the text the model already reads. Rejected per the user's "transcript-first" call. |
| **A second inline "audio tab" alongside the video** | Treats the symptom. The real fix is to stop the type flip so the video never disappears in the first place; the existing Description/Transcript tabs then suffice. |

### Consequences

- A video memo can gain a transcript **and** keep its inline player — the
  reported bug is structurally impossible now (transcript never sets
  `type`/`file_path`).
- New columns: `transcript_source`, `summaries` (migration
  `backend/migrate_transcript_summary.py`, PRAGMA-guarded ALTER TABLE).
- "Make it local → Audio only" is now an explicit, warned podcast conversion —
  the long-video→podcast workflow is preserved, just no longer the transcript
  path.
- Summary is now three modes instead of one; the single `ai_summary` is kept in
  sync for the `insights` mode so nothing downstream breaks.
- Memos already flipped to `audio` by the old `audio_transcript` path are not
  auto-migrated; they can be re-saved or repaired manually.

---

## ADR-003 — "Make it local" visibility is gated to remote, localizable media (tiered capture)

**Date:** 2026-06-02 · **Status:** Accepted

### Context

A saved URL can be captured in several different ways depending on what it is.
The "Make it local" panel (which downloads a remote media item to a local file
via yt-dlp) was appearing on memo types where it is meaningless — articles,
links, images, notes, documents — cluttering the detail page and confusing
users. "Make it local" is only meaningful for a remote, yt-dlp-pullable media
item that is not already stored as a local file.

At the same time, different memo types require different capture strategies at
save time. Lumping all URLs under a single action model obscures these
differences and creates implicit dead ends for non-media types.

### Decision

OpenMemo uses a **tiered capture strategy** keyed off memo type. "Make it
local" is exactly **one tier** — not a universal action available everywhere:

| Memo type | Capture strategy | Make it local? |
|-----------|-----------------|----------------|
| `link` / `article` | Server-side scrape (headless Chromium, see ADR-002) — content + hero image captured at save time | No |
| `image` (including social photo pages such as FB/IG/X) | Scrape the real image URL; store locally at ingest | No |
| `video` / `audio` from a yt-dlp platform (remote, not yet downloaded) | Platform iframe/embed available immediately; **"Make it local"** appears to download a playable local copy | **Yes** |
| Auth-walled private media | Browser extension (logged-in session); no logged-out download path | No |

The decision of whether to show the panel is centralized in a single predicate
`canMakeLocal(memo)` in `frontend/src/lib/media.ts`:

- `memo.type` is `'video'` or `'audio'`
- `memo.source_url` is present (remote origin exists)
- `memo.file_path` is absent (not already downloaded)
- `memo.localize_status !== 'done'` (job not already completed)

The panel renders in `MemoDetail`, below the platform embed.  All four
conditions must hold; failing any one suppresses the panel.

See `docs/make-it-local.md` for the full implementation, gating predicate,
component placement, download modes, and end-to-end user flow.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Show "Make it local" on every memo type** | Meaningless and misleading on non-media types — implies you can "download" an article or a note. Adds clutter without value. |
| **Scatter per-type `if` conditionals across components** | They drift out of sync as the codebase grows; violates the single-source principle established in ADR-001 (memo-type changes must be systematic across the whole type, not scattered per-provider). |
| **Separate "download" button per type with no shared predicate** | Same fragmentation risk; harder to test; requires updating multiple render sites when the localize eligibility rules change. |

### Consequences

- One predicate (`canMakeLocal`) is the single source of truth for panel
  visibility; updating it propagates correctly to every render site with no
  drift.
- Non-qualifying memo types fall back to their type-appropriate action (Open
  original, image preview, editable note, Download original) — no memo type is
  a dead end.  Satisfies the graceful-fallback rule from ADR-001.
- The tiered model makes the capture strategy for each memo type explicit and
  auditable in one place (this ADR + the predicate), rather than implicit in
  scattered component logic.
- New yt-dlp-supported types (e.g. a future `podcast` type) are opted in by
  updating `canMakeLocal` alone; everything else is unchanged.

---

## ADR-002 — Self-hosted headless Chromium replaces Microlink for link extraction

**Date:** 2026-06-02 · **Status:** Accepted

### Context

OpenMemo saves any URL as a link memo by fetching the page and extracting its
title, description, thumbnail (via `og:image`), and readable content. Two
categories of page resist a plain HTTP fetch:

1. **Antibot / JS-challenge pages** — sites protected by Cloudflare's *managed
   challenge* return HTTP 202 with a tiny JavaScript stub. The stub has no
   OpenGraph data; the real DOM only appears after the challenge JS runs in a
   real browser. Examples: Dribbble, Behance.

2. **JS-rendered SPAs** — pages whose `<head>` metadata is injected by
   client-side JavaScript after the initial HTML loads, leaving a plain fetch
   with nothing useful.

The previous code path used the **Microlink API** (free tier) as the fallback
for these cases. Two problems broke that:

- `extract_url` was refactored to call `raise_for_status()`, which lets
  HTTP 202 challenge stubs pass as successful; the Microlink call never
  triggered.
- Even when reached, Microlink's free tier began returning `EPROXYNEEDED` for
  any site that uses antibot protection, with a prompt to upgrade to the paid
  PRO plan. The sites Microlink now refuses are exactly the antibot-protected
  ones we needed it for.

OpenMemo is **local-first** and must not depend on a paid third-party API.

### Decision

Embed a self-hosted **headless Chromium** (via Playwright) directly in the
`openmemo-api` Docker image. When a plain HTTP fetch is not enough, the app
drives a real browser that executes challenge JS and delivers the fully rendered
DOM — including real `og:image` and readable content — with no third-party API,
no key, and no per-site rate limit.

Microlink was **removed entirely** from the codebase (no fallback, no free
tier).

#### How it works

`backend/core/extractor.py` — `extract_url()` — implements a three-stage chain:

1. **Fast plain HTTP fetch** (`httpx`). If the response is a genuine HTTP 200
   *and* `_parse_html()` produces usable content (title / image / text), return
   immediately. A non-200 response (including a 202 challenge stub) or a 200
   that renders to nothing falls through to the next stage.

2. **Headless render** (`_minimal_link()` → `render_page()` in
   `backend/core/headless.py`). Launches Chromium, navigates to the URL,
   waits for `og:image` / `og:title` meta to appear (up to 12 s), then for
   network idle (up to 6 s), then reads `page.content()`. The rendered HTML is
   fed back to `_parse_html()`. This stage executes the Cloudflare challenge JS
   so the real DOM is available.

3. **Direct OpenGraph scrape** (`_fetch_og_meta()`). A lightweight browser-UA
   `httpx` request that reads only meta tags — for pages that block the API
   path but serve HTML fine to a real user-agent. This is a cheaper fallback
   before the final safety net.

4. **Preview-unavailable card** (final fallback). A memo is still created with
   the source URL intact so the user can open the original — a save never
   dead-ends.

`backend/core/headless.py` is a **lazy singleton**: Chromium launches on first
use, stays warm across requests (each render gets its own incognito
`BrowserContext`, closed after the request), and is shut down cleanly via
`close_browser()` called from the FastAPI app lifespan in `backend/main.py`.
If Playwright or the binary is unavailable, `render_page()` returns `None` and
the chain degrades to the plain-fetch path — the feature is purely additive.

The browser binary is installed in the Docker image via:

```dockerfile
RUN python -m playwright install --with-deps chromium chromium-headless-shell
```

`playwright>=1.49.0` is declared in `backend/requirements.txt`; the OS
libraries are pulled by `--with-deps` on the slim Debian base.

#### Scope boundary

This solves **antibot** (Cloudflare managed challenge) for **public** pages.
It does **not** defeat **auth walls** — private Facebook photos, logged-in
Instagram posts, and similar content require a valid session cookie that no
anonymous browser can supply. Those links still need the browser extension.
Antibot solved ≠ auth-wall solved.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Microlink PRO** (paid API) | Violates local-first principle; OpenMemo must work without any cloud API or subscription. |
| **`curl_cffi` TLS impersonation** | Tested — the managed JS challenge is not a TLS fingerprint problem; both `curl_cffi` and `cloudscraper` still receive HTTP 202. A real JavaScript engine is required. |
| **`browserless` sidecar container** | The underlying engine Microlink uses; cleaner isolation, but adds ~1 GB extra container and more infrastructure orchestration. Embedding Chromium in the API image is simpler and sufficient for a single-user local app. |
| **Ignore antibot sites / extension-only** | Leaves Dribbble, Behance, and similar sites permanently broken as link memos. Rejected by the product owner — these are legitimate design-inspiration sources. |

### Consequences

- **Image size** — `openmemo-api` grows by approximately 400 MB (Chromium
  binary + required OS libraries installed via `--with-deps`).
- **Ingest latency** — saving a bot-walled link now takes roughly 10 s while
  the headless render completes. The render runs in-request synchronously; a
  possible future improvement is to move it to the existing background ingest
  task.
- **Container flags** — Chromium runs with `--no-sandbox` and
  `--disable-dev-shm-usage` inside the Docker container, as required when
  there is no user-namespace sandbox. This is standard and expected for
  containerized headless browsers.
- **No third-party dependency for link scraping** — the entire extraction chain
  (`extract_url` → `_minimal_link` → `render_page` → `_parse_html`) runs
  locally. A save works fully offline (except for the actual page fetch).

---

## ADR-001 — Memo-type changes are systematic across the whole type, not per-provider

**Date:** 2026-06-02 · **Status:** Accepted

### Context

Every memo has a *type* (`video`, `audio`, `link`, `image`, `document`, …), and
each type spans many *providers* / hosts:

- **video** — YouTube, Vimeo, Instagram, TikTok, Facebook, X, VK, Dailymotion,
  Twitch, Streamable, …
- **audio** — SoundCloud, Bandcamp, Mixcloud, …

Repeatedly, a feature was built for one provider and hardcoded to it, silently
breaking every other provider of the same type:

- The detail-page video embed handled **only YouTube**. Vimeo, Instagram,
  TikTok, VK and every other host got no inline player and a dead
  "No preview available" in the lightbox.
- The minimal video card showed a brand glyph only for YouTube/Vimeo; every
  other host fell back to a generic "video file" icon.

A user who never touches YouTube — say someone who only saves VK or Vimeo video
— experiences the feature as broken, even though "it works" for the provider it
was built against. A "YouTube embed" task is really a **video-type** task; an
"audio player" task is really an **audio-type** task.

### Decision

When a feature or change touches one provider/variant of a memo type, the
**default scope is the entire memo type** — every provider of that type — not
the single provider that prompted the work. Provider differences are routed
through a **shared abstraction**, never inlined as per-host conditionals
scattered across render components.

Operating rules:

1. **Default scope = the memo type.** "Add a video embed" means *all* video
   hosts. "Restyle the audio player" means *all* audio sources — change it for
   SoundCloud, change it for Bandcamp and Mixcloud too.
2. **Centralize provider differences.** One registry/abstraction
   (e.g. `frontend/src/lib/platforms.ts` for video hosts) consumed by every
   render site — card, lightbox, detail. No `if (host === 'youtube')` sprinkled
   through components.
3. **Confirm scope before starting.** If a request names a single provider,
   **stop and confirm with the user before coding**: surface a short plan and
   ask — *"this touches the `<type>` memo type; apply to all `<type>` providers,
   or just `<provider>`?"* Do not begin until the user confirms. Keep the user
   in the loop on scope.
4. **Graceful fallback is mandatory.** A provider we did not explicitly wire
   must still degrade safely (Open original / Make it local) — never a dead end.
   This guarantees robustness for hosts we haven't special-cased (e.g. VK).

### Consequences

- Slightly more upfront thought per change, in exchange for no silent
  regressions for non-default providers.
- Provider logic lives in one place and is unit-testable as a matrix
  (see `frontend/src/lib/platforms.test.ts`).
- A new provider is added in one file and lights up card + lightbox + detail
  simultaneously.

### Examples

- ❌ YouTube-only embed in `MemoDetail` → VK / Vimeo / Instagram users get nothing.
- ✅ Registry-driven embed across all video hosts + graceful Open original.
- ❌ SoundCloud-only audio-player restyle → Bandcamp / Mixcloud drift out of sync.
- ✅ One audio-player treatment applied to every audio source.

### Reference implementation

The video embed work (changelog 2.0.3) is the canonical example: a single
`lib/platforms.ts` registry maps host → brand glyph + embed URL, consumed by
`MemoCard`, `Lightbox`, and `MemoDetail`, with graceful fallback for unknown
hosts and a host test matrix in `lib/platforms.test.ts`.
