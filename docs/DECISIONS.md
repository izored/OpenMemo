# Architecture & Process Decisions

Significant decisions about how OpenMemo is built and how I scope changes.
Newest first. Each entry is an ADR (Architecture Decision Record): the context,
the decision, and its consequences, so a future reader knows *why*, not just
*what*.

---

## ADR-015: Playlists are collections with a kind, and music lives on its own page

**Date:** 2026-06-11 · **Status:** Shipped · **Builds on:** ADR-005 (voice vs music split), ADR-004 (yt-dlp is the shared engine for remote media), ADR-012 (one cookie jar for every yt-dlp call), ADR-001 (define shared things once)

### Context

Music Experience V2 (OPNMMO-0023) needs playlists, a Music page, playlist ingestion from a single pasted URL, and a clean home feed. The tempting design is a parallel world: a `playlists` table, a `tracks` table, a music-specific player. That doubles every concern we already solved for memos and collections: linking, deletion, search, embedding, file serving, drag and drop.

### Decision

**No parallel world. Playlists are collections, tracks are audio memos, and one `kind` column keeps the two UIs apart.**

- `collections.kind` is `'standard'` or `'playlist'` (additive migration, NULL backfilled). `collections.source_url` records where a playlist came from, for provenance and a future re-sync.
- The collections API filters to `kind=standard` **by default**, so the sidebar, the collections page, and every picker hide playlists with zero frontend changes. The Music page asks for `kind=playlist` explicitly.
- Tracks are plain audio memos (`audio_kind='music'`) linked through the existing `memo_collections` table. Playlist order rides on the same `recency_at` stagger drag-to-reorder uses (track i gets `now - i` seconds).
- Ingestion is two explicit steps: a `--flat-playlist` probe (metadata only, capped at 100 entries because a YouTube Mix is infinite) behind a cheap URL-shape gate, then a per-track sequential download through the existing localize pipeline. **Saving a playlist is always a deliberate pick in the New Memo panel, never a default**, and downloading is opt-in (`download: false` keeps tracks remote, with per-track and download-all affordances later — like any music app).
- Progress is **derived state**: counts over per-track `localize_status`, computed by `GET /api/music/playlists`. No job table, no in-memory job registry; a server restart loses nothing, and failed tracks stay individually retryable.
- The home feed excludes playlist members server-side (unless a collection or an `audio_kind` is asked for explicitly). A hundred ingested tracks never flood All Memos; the Music page and the Music filter own them.
- The shared single-`<audio>` player (ADR-005) gains a queue (`playQueue` / next / prev, auto-advance on end, repeat-one wins). Playing a single track anywhere clears the queue — no hidden state.

### Consequences

- Every memo feature works on tracks for free: detail page, pin, delete-with-undo, search, thumbnail editing, drag onto a collection or playlist card (the same `col-` droppable namespace).
- Deleting a playlist deletes only the collection; the tracks stay in the library, consistent with collections everywhere else.
- The feed exclusion means a memo filed in BOTH a standard collection and a playlist is hidden from All Memos; accepted, the Music page shows it.
- `memo_collections` has no position column, so manual playlist reorder is deferred (order = ingest stagger).
- Embedded streaming of undownloaded YouTube tracks is not possible through the shared `<audio>` graph (cross-origin media silences the WebAudio analyser path); remote tracks open their memo instead, and the download chips are the music-app answer until a same-origin stream proxy exists.
---

## ADR-014: Ollama integration is resilient by construction: resolved models, prefixed embeddings, a live-only vector index

**Date:** 2026-06-10 · **Status:** Shipped · **Builds on:** ADR-001 (define shared things once), ADR-007 (one summarize predicate), ADR-008 (keep work off the hot path)

### Context

The AI layer looked wired up but failed quietly at every seam. Summarize returned a bare 500 on most memos. Ask Memo retrieved chunks that had nothing to do with the question. Nobody got an error message for any of it.

Five independent faults stacked:

1. **The configured chat model did not exist.** `DEFAULT_CHAT_MODEL=qwen2.5:7b` was never pulled. Every backend-initiated Ollama call 404'd, the API turned that into a 500, and the frontend logged it to the console and showed nothing.
2. **Embeddings were generated wrong for the embed model.** `nomic-embed-text-v2-moe` is trained with task prefixes (`search_document:` / `search_query:`). Without them, documents and queries land in different regions of the vector space and nearest-neighbour search returns near-noise. We sent raw text on both sides.
3. **The vector index kept ghosts.** Soft-deleting a memo never touched ChromaDB. 60 of 145 chunks belonged to deleted memos, so retrieval cited cards that 404 on click.
4. **Scoping was silently broken.** `search_similar` accepted `collection_id` and ignored it: collection chat searched the whole library. A multi-key Chroma `where` would also crash on current Chroma (needs `$and`).
5. **Context windows were silently truncated, twice.** Ollama defaults `num_ctx` to 4096 and drops the prompt tail without erroring, so long transcripts lost their second half. And 512-token chunks plus the nomic prefix overflow the embed model's own 512-token window, so chunk tails embedded as if they did not exist.

### Decision

**1. Models are resolved, never assumed.** Every chat/summary call goes through `OllamaClient.resolve_chat_model()`: explicit request → user's Settings default (`app_settings.chat_model`, persisted server-side) → env `DEFAULT_CHAT_MODEL` → any installed non-embed model. Matching is case-insensitive against `ollama list`. An explicit request for an absent model raises `OllamaModelMissing`, which the API maps to a 502 with the pull command in the message. The frontend shows that text inline (SummaryPanel error state, chat `error` SSE event) instead of swallowing it.

**2. Embedding calls carry the model's task prefixes.** `embedder.py` prepends `search_document:` at index time and `search_query:` at query time whenever the embed model is a nomic family member. Stored chunk text stays clean; the prefix exists only in the embedding input. Chunk size dropped to 384 tokens (overlap 64) so chunk + prefix fit the embed model's 512-token window.

**3. The vector index only ever holds live memos.** Soft-delete purges the memo's chunks; restore re-embeds in the background. `POST /api/maintenance/reindex` (Settings → Local AI → Rebuild) rebuilds everything with the current model and chunking and sweeps ghosts, for upgrades and embed-model changes. Search results additionally filter `is_deleted` on the SQL side as a belt-and-braces.

**4. Retrieval is scoped and thresholded.** `collection_id` resolves to that collection's live memo ids and filters with `$in`; multi-condition filters build a proper `$and`. Chunks beyond `RAG_MAX_DISTANCE` (cosine, default 0.80) are dropped. Zero surviving chunks short-circuits to an honest "nothing relevant in your memos" message instead of letting the model improvise over an empty context. Chat history now also rides along in RAG mode, so follow-ups work.

**5. The context window is explicit.** All chat calls pass `options.num_ctx` (`OLLAMA_NUM_CTX`, default 8192). Config loads from `backend/.env` by absolute path, so the dev server started from the repo root stops silently running on code defaults.

### Consequences

- A wrong or missing model degrades to the best installed one, and every Ollama failure reaches the user as readable text, never a silent console line.
- Retrieval quality is a property of the index. After changing `EMBED_MODEL`, run Rebuild; mixed-model vector spaces are garbage and nothing can fix them at query time.
- The default model is one server-side setting shared by every surface (Settings dropdown writes it, summaries and chat read it). Per-request overrides stay possible.
- Reindex is a heavy, Ollama-dependent endpoint; it stays manual (a Settings button), never automatic on startup.

---

## ADR-013: Custom appearance backgrounds are ingested server-side at full quality

**Date:** 2026-06-07 · **Status:** Shipped · **Builds on:** ADR-011 (the live appearance preview is the Settings hero), ADR-001 (define shared things once)

### Context

A custom background was captured client-side: the upload was downscaled to 1280px and re-encoded as a JPEG at 0.72 quality, then stored as a base64 **data URL in `localStorage`** (`tweaks.bgImage`). That was fine while the background was always blurred 64px, but it broke down once you could drop the blur to 0: the image showed soft and washed out. The deeper problem is the storage medium. `localStorage` caps around 5 MB for the whole origin, and a base64 photo inflates ~33%, so a real full-quality image cannot live there without risking a `QuotaExceededError` that corrupts the entire tweaks store. The downscale existed to dodge that limit, at the cost of quality.

### Decision

**Ingest the background server-side at full quality, and keep only its URL on the client.**

- The original bytes are stored under `DATA_DIR/background.<ext>` (one file; a replace with a different extension removes the old one). The active extension is recorded in `app_settings` as `bg_image_ext`.
- New routes: `POST /api/settings/background` (multipart, magic-byte image sniff so we trust content not filename, 10 MB cap), `GET /api/settings/background` (serves the file), `DELETE /api/settings/background`.
- The client stores only `tweaks.bgImage = "/api/settings/background?t=<ts>"` (a tiny string, cache-busted on replace). **Rendering is unchanged**: `applyTweaks` still sets `--bg-image: url(...)`, so the CSS path is identical whether the URL is a data URL or this endpoint.
- **Large-image seam.** Images over 10 MB route through `_lossless_compress_seam()`, an architecture placeholder that currently declines them with a clear message. No compressor library is added yet (per OPNMMO-0018); when compression lands, it slots into that one function. The prior 5 MB hard cap is raised to 10 MB so mid-size images go through now.
- **0% blur stays subtly treated.** At blur 0 the filter is genuinely `blur(0px)`, but the `saturate(120%)` and the dark-theme brightness dim remain, so cards stay legible over a bright photo. "0%" means no blur, not raw pixels.

### Consequences

- Backgrounds render at full quality, and `localStorage` holds a short URL instead of a megabyte data URL, so the tweaks store can never overflow on a background.
- The background now depends on the backend (it was purely client-side before); the dev and Docker proxies already route `/api` so this is transparent.
- There is exactly one background file on disk; no orphan accumulation.
- Images over 10 MB are declined until the compression seam is implemented.

---

## ADR-012: Restricted "Make it local" downloads use a user-supplied cookie jar, guided by an in-app walkthrough

**Date:** 2026-06-07 · **Status:** Shipped · **Builds on:** ADR-003 ("Make it local" is gated to remote, localizable media), ADR-001 (define shared things once, scope across the whole memo type), ADR-004 (yt-dlp is the shared engine for remote media)

### Context

"Make it local" downloads a remote video or audio source with yt-dlp so the memo survives the original being taken down. It runs on the server, anonymously. Age-restricted, private, and other login-gated sources refuse an anonymous request, so the download fails. Two things were broken for the user:

- **The detail-page embed also fails** for age-restricted YouTube, because the platform refuses to play those videos in an iframe. Nothing client-side can fix that.
- **The failure was a dead end.** The panel showed a generic "Download failed. The source may be private, region-locked, or unsupported by yt-dlp." with a bare **Try again** that would just fail the same way. A non-technical, local-first user had no path forward.

The real fix is the same one a browser uses: present the site with the cookies of a logged-in account. yt-dlp accepts a `--cookies` jar for exactly this. The open questions were where the jar lives, how the user supplies it without touching Docker or the filesystem, and how to be honest about the privacy trade-off.

### Decision

**Let the user hand openMemo a `cookies.txt`, pass it to yt-dlp for every remote fetch, and turn the dead-end failure into a guided, reusable walkthrough.**

**1. One provider-agnostic auth point.** A single `_cookie_args()` helper in `core/localize_media.py` returns `["--cookies", <path>]` when a jar exists, spliced into both the download and thumbnail yt-dlp calls. It is never per-host. Per ADR-001 this means it works for every video and audio provider at once (private Vimeo, member SoundCloud, and so on), not just YouTube.

**2. The jar is credentials, treated as such.** Stored at `DATA_DIR/yt_cookies.txt` (a Docker volume in the container deployment). It is **never returned over the API and never logged**; only a computed boolean `yt_cookies_present` is exposed on `GET /api/settings`. Upload (`POST`) and delete (`DELETE`) live under `/api/settings/cookies`, with Netscape-format validation, atomic writes, and a 5 MB cap (a full multi-site export is still tiny). It is git-ignored explicitly on top of living under `data/`.

**3. Failures explain themselves.** A new nullable `Memo.localize_error` column (PRAGMA-guarded additive migration) stores yt-dlp's last message. The UI keyword-matches it to tell a sign-in / age gate (cookies fix it) apart from a region-lock or an unsupported source, and clears it on retry and on success.

**4. The recovery is a reusable guide, not a one-off.** `MakeItLocalPanel`'s error branch now offers **Follow these steps** beside Try again, plus a softer "do you really want this one saved?" nudge. It opens `GuideModal`, a centered, fixed-height step popup driven by a `GuideId` in the store and mounted once via `GuideHost`, where steps are data and any step can render a live control. The first guide (`yt-cookies`) is six steps: why it failed, **how safe is this?**, install an exporter, sign in, export, and a final step that embeds a self-contained `CookiesUpload` (drag-drop, replace, remove). The same upload + guide are reachable from a Settings row.

**5. Privacy stance, stated plainly in the UI.** Everything is local. yt-dlp is a program on the machine, not a service. The only time a cookie crosses the network is yt-dlp's request to the video host, exactly as the browser does on play. There is no openMemo server to send anything to. The guide's "How safe is this?" step says this and steers the user to a throwaway account.

**6. Encryption at rest is deliberately deferred.** With no server and no user password, any decryption key must live on the same machine, so app-key encryption is obfuscation, not real secrecy, and DPAPI (the one genuinely OS-backed option) does not exist inside the Linux container we actually deploy. We chose honesty over theatre: plaintext under a git-ignored volume now, with file-permission hardening and optional encryption tracked as future work, rather than a false "unbreakable" claim.

### Consequences

- **Restricted and private downloads become recoverable** by a non-technical user, entirely in-app, no CLI or volume editing.
- **A reusable guide framework** now exists; future walkthroughs are a data array, not a new component.
- **Cookies are credentials sitting on disk.** Mitigated by: never logging or returning them, git-ignoring them, expiry being self-correcting (re-export), and explicit throwaway-account guidance. Not yet mitigated by encryption (see point 6) or tightened file permissions (tracked).
- **The embed wall remains** for age-restricted video; only the download path is unlocked, after which the local copy plays freely.
- **New schema column** `localize_error`; handled by the existing additive-migration list in `main.py`.

---

## ADR-011: Settings is a bento, and the live appearance preview is its hero

**Date:** 2026-06-06 · **Status:** Shipped · **Builds on:** ADR-001 (define shared things once)

### Context

The Settings page was a uniform two-column stack. Every card carried the same
width and weight, so nothing led the eye. Three problems:

- **The appearance live-preview was buried.** It is the feature I am most proud
  of (theme, accent, card style, layout, columns, background, all previewing
  live), but it sat as one busy little CTA row with three chips, the same size as
  "Max upload size". Low priority for a headline feature.
- **The stats row shifted the page.** Library counts rendered only after the
  fetch resolved, and the space was not reserved beforehand, so when the numbers
  arrived the whole page jumped down.
- **Cards left dead space.** A short card (Trash) next to a tall one (Uploads)
  stretched to match its grid row, leaving empty space below its content.

### Decision

**I rebuilt Settings as a bento: full-width feature blocks stacked over a true
masonry of the smaller cards.** Source order maps to reading order, and the
layout stays robust to variable content height.

**1. Appearance is the hero.** A full-width panel at the top with its own surface
(theme-aware), the user's accent as the only color, a large title, one clear
"Open live preview" CTA, and a mini window mock. It is the first thing on the
page now, not a footnote.

**2. Stats strip with reserved height.** Five number tiles always render. While
the fetch is in flight each shows a shimmer skeleton, so the row holds its height
from first paint and never jumps. Numbers fade in when they land.

**3. Masonry for the rest.** The functional cards (Profile, Local AI, Browser
extension, Files, Made by) flow in a CSS multi-column masonry. Short cards get
hugged by the next instead of stretching, so there is no dead space.
`break-inside: avoid` keeps each card whole. The class is `om-settings-masonry`
because `om-masonry` already belongs to the memo grid.

**4. Grouping.** Trash folded into the Files card as a row (it was a near-empty
card on its own). Data safety and the Danger zone sit side by side as a
half-width duo at the bottom, where destructive actions belong.

**5. Default model lives in Settings.** The Local AI card gained an in-brand
dropdown that sets the app-wide default chat model. It writes the persisted
`chatModel` in the app store, which every Ask and chat surface already reads
(ADR-001, one source of truth). No backend change, no new setting to keep in
sync.

**6. Creator preferences are marked, not forced.** In the live-preview panel, the
options I run openMemo with (Card Minimal, Layout Boxed, Player Big) carry a
small accent asterisk with a one-line key in my voice. A hint, never a default
override.

### Consequences

- The page leads with its best feature, and the appearance preview reads as the
  headline it is.
- No layout shift on load; the stats area is stable.
- Adding or removing a settings card is drop-in: it joins the masonry and packs
  automatically, with no column bookkeeping.
- The theme cross-fade works because the hero uses a solid `background-color`.
  The app's global theme transition animates `background-color`, not
  `background-image`, so a gradient hero jumped while the text faded. A solid
  color fades with everything else; a fixed `::before` sheen keeps the depth
  without changing between themes.
- One naming gotcha logged: `om-masonry` was already the memo grid's flex
  masonry, hence `om-settings-masonry` for the new multicol one.

---

## ADR-010: The full-bleed now-playing player is corner-anchored, with a shared volume engine and one-line marquee titles

**Date:** 2026-06-05 · **Status:** Shipped · **Builds on:** ADR-005 (audio is a first-class media experience; the sidebar hosts the now-playing player), ADR-001 (define shared things once)

### Context

I built the full-bleed music player (the inline card overlay `CardMusicPlayer`,
and the `big` sidebar player) on the textbook transport layout: a **centered**
white play button flanked by repeat (left) and pin (right), scrubber pinned to
the top. Three problems:

- **The center play button sat on top of the cover art**, the one thing a music
  surface exists to show. The transport row dominated the lower third.
- **The "big" sidebar player's close button escaped its container.** `.om-sb-player-big`
  had no `position`, so its `position:absolute` X resolved against an ancestor and
  rendered at the **top of the whole sidebar**, with an arrow's-length of empty
  space between it and the player it belonged to.
- **There was no volume control anywhere**, and titles truncated with a static
  ellipsis. Long track names ("Your Mind Will Disappear Into This…") were
  unreadable past the cut.

This is my app, not a stock media widget. There is no obligation to keep
play-in-the-middle-with-two-flankers. With code, the controls can go anywhere.

### Decision

**I redesigned the full-bleed player around the cover: corner-anchor the
transport, drop the scrubber to the bottom, add a shared volume engine and a
one-line marquee title.** This applies to both full-bleed surfaces (the inline
card player and the `big` sidebar player). The compact `small` sidebar player and
the audio card inherit the volume and marquee pieces but keep their row layout.

**1. Corner transport cluster.** Play is the primary control, a large disc in the
**top-right corner**. Pin and repeat are smaller satellites beside/below it
(`.om-card-player-sat` / `.om-sb-player-sat`). No centered button, so the cover's
center stays clear. The close X (sidebar `big` only) moves to the **top-left** so
it never collides with the cluster, and is anchored by giving `.om-sb-player-big`
`position:relative` (the bug above) and revealed on hover.

**2. Scrubber to the bottom.** The same scrubber component (elapsed · track ·
duration) moves to a bottom block, directly above the title row. Unchanged
markup, repositioned.

**3. One volume engine, every surface.** `AudioPlayerProvider` gains `volume`
(0..1, persisted to `localStorage`) and `muted`, applied to the single shared
`<audio>` and re-applied on each track load. `setVolume` (which clears mute when
dragged up) and `toggleMute` are exposed on the context, so the card player, both
sidebar players, and anything future stay in sync through one source of truth
(ADR-001), never per-surface `<audio>.volume` writes.

**4. The volume control is a deliberate, self-announcing affordance.** A
`VolumeControl` component renders an animated speaker icon + the title on the
bottom row. Clicking the icon mutes (icon → ✕). Hovering slides a slider out
**over the title in place**, lingering ~2s after the pointer leaves so it can be
grabbed. The resting icon **pulses every 15 seconds**: waves sweep 0→3→0 then
settle on the count that matches the current level (≤30% → 1 wave, ~50% → 2, high
→ 3). That tells the user *which* card is the one playing and reminds them the
control is there. Dragging the slider updates the wave count live.

**5. One-line marquee titles.** A `Marquee` component truncates to a single line
with an ellipsis at rest; on hover, if the text overflows, it slides left to
reveal the end then returns (a single pass, not a loop), at a constant reading
speed proportional to the overflow. Honors `prefers-reduced-motion`. I use it in
the player titles now; it is reusable on any card title.

**6. Theming.** Full-bleed controls are white-on-cover (the cover/scrim is always
dark enough). The slider and icon fall back to theme tokens only on the
non-tinted `small` sidebar player, which sits on a light surface.

**7. The aurora glow is untouched.** The cover-mood aurora behind the active music
card (ADR-005) is explicitly out of scope and unchanged.

**8. The detail page gets a hero player; the source widget is a collapsible
reference.** A music memo with cover art renders a large cover-forward "now
playing" card on its detail page (`MusicDetailPlayer`): the cover bleeds full-
bleed and a left→right mood-gradient *veil* fades it into the solid cover color
where the title / centered transport / scrubber sit (one image + a gradient, so
there is no side-by-side seam). Voice and cover-less audio keep the compact bar.
The live platform widget ("Listen on SoundCloud") gains a brand-glyph heading
that doubles as a **show/hide toggle**, and is **collapsed by default once the
track is local** (it is then only a secondary reference). Its redundant "Open
original" button is dropped, since the source link at the top of the page already
covers it.

**9. Music transcript is deferred to lyrics.** A song's "transcript" is its
lyrics, which need a dedicated provider (LRCLIB / embedded tags / lyrics.ovh, the
local-first set deferred in ADR-005). Until that lands, the transcript panel is
**hidden for music** (`audio_kind === 'music'`); voice (spoken word) keeps it.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Keep centered play + two flankers** | Covers the artwork and reads like a generic widget. The whole point of a cover-first player is to show the cover. |
| **Fix the runaway close X with `margin`/flow tweaks** | The X escaped because its absolute parent was unpositioned; the correct fix is `position:relative` on the player, not fighting layout. |
| **A separate volume `<audio>` or per-surface volume state** | Breaks the one-shared-`<audio>` invariant (ADR-005) and drifts between surfaces. One engine value, read everywhere (ADR-001). |
| **Always-looping ticker title** | More motion, more distracting; a single hover pass reveals the full title without turning the grid into a ticker wall. |
| **Static volume icon** | Misses the chance to signal which card is playing and that the control exists; the 15s pulse is the affordance. |

### Consequences

- New shared pieces: `Marquee.tsx`, `VolumeControl.tsx`; `volume`/`muted`/
  `setVolume`/`toggleMute` on the audio context. Volume persists across sessions.
- `CardMusicPlayer` and the `big` sidebar player are restructured to the corner
  cluster + bottom block; the `small` player gains a volume button + marquee
  title.
- The active music card's hover actions shift to the **top-left** so they clear
  the play cluster.
- The `big` sidebar player's close button is anchored to the player and
  hover-revealed.
- Preserves ADR-005 (one `<audio>`, sidebar player, aurora) and ADR-001 (single
  source for the volume value and the marquee/volume components).
- New `MusicDetailPlayer` (detail hero). The detail source widget is collapsible
  and collapsed-by-default once local; the music transcript panel is hidden
  pending lyrics, replaced by a togglable `MusicDescription` (the source's own
  description, tracklist/timestamps/notes, which is not a transcript). Related
  Memos is temporarily hidden on the detail page (UX revisit, code retained).
- New `audio_artist` column + `mutagen` dep: artist read from an uploaded file's
  tags (any format) at ingest; shown in the hero (and OS media metadata) only
  when a real tag exists, never the source domain.
- The hero veil/sizing is driven by CSS vars with shipped fallbacks; a "Gradient"
  tab in the existing DEV panel (`src/dev/DevPanel.tsx`) tunes them live via
  `--dev-*` on `:root` (DEV-only, production untouched). Tuned/shipped behavior:
  - **Mood brightness is theme-aware and animated.** Applied as a
    `filter: brightness()` on the veil (100% light, **50% dark**), not a gradient
    color-mix, because a gradient `background` can't transition but a filter can.
    The value is set **concretely per theme** (dark base `0.5`, `[data-theme="light"]`
    overrides to `1`) rather than through a flipping CSS var, so the change
    reliably triggers the `transition: filter` and cross-fades instead of jumping.
  - **Cover width follows the artwork aspect.** A 16:9 video thumbnail (e.g. a
    localized YouTube track) gets an 80% panel; square music art (uploaded file,
    SoundCloud) gets 40%. Measured from the image, set per-memo via `--cover-w`,
    and the width change is animated (`transition: width`) so it doesn't jump
    between memo types.
  - The hero's pill controls (repeat, volume) get a `backdrop-filter` blur behind
    them so they read over busy artwork.
  - The brightness crossfade required adding `filter` to the
    `.om-app.theme-transitioning *` transition allow-list. That rule sets
    `transition: ... !important` for the 3s theme-swap window, and omitting
    `filter` made the veil snap; with it, the dim eases across the swap.
- **Hero loads as one unit.** `MusicDetailPlayer` holds `opacity: 0` until the
  cover image has loaded and its aspect is known, then fades in, so the panel
  width settles (40↔80) while hidden and nothing pops in piecemeal.
- The detail meta-row source chip (`.om-source`) gained a hover state.
- The marquee `auto` mode loops slowly (duration scales with overflow) on the
  active now-playing surfaces; non-active titles still scroll on hover.
- **Not addressed here:** the lyrics provider itself; extending the marquee to
  *every* card type (follow-up); a volume gesture on the collapsed mini-player.

---

## ADR-009: Make the whole UI responsive in place, one codebase that adapts every page from desktop to mobile

**Date:** 2026-06-04 · **Status:** Designed, not yet built · **Relates to:** ADR-006 (sidebar is a fixed three-zone column), ADR-005 (the sidebar hosts the now-playing player), ADR-008 (keep work off the request/render hot path), ADR-001 (define shared things once, never scatter)

### Context

OpenMemo was built desktop-first. **No page is designed for a small screen.** The shell (`.om-app`) is a two-child flexbox: a fixed sidebar rail (`260px` / `76px` collapsed) plus a flexible `.om-main`, and nothing collapses that below any width. The few `@media` rules that exist are one-off patches inside single components (Settings at 1100px, Ask history at 1000px, one detail grid at 720px); there is no app-wide responsive system. On a phone today, every page breaks in its own way:

- **Sidebar:** a static column that eats ~67% of a 390px screen (or 19% collapsed); no drawer, no way to get it out of the way. `.om-main` is crushed beside it.
- **Dashboard feed:** `MemoGrid` never goes below **2 columns** (`useViewportColumns` floors at 2 under 900px; `react-masonry-css` has no `1`), so cards are unreadably narrow on a phone.
- **Sidebar player:** `SidebarPlayer` is laid out in fixed pixels inside the ~236px rail with no `min-width:0` and no wrap, so the transport **clips**; the current workaround is to drop the browser to **90% zoom** to see the buttons. (Reproduces under desktop zoom too. It's a sizing bug, not only a phone bug.)
- **Settings:** the bento grid only stacks at 1100px; the cards and rows inside it have no phone treatment.
- **Collections:** multi-column grid with no single-column fallback.
- **Ask:** two-column shell; history hides at 1000px but the rest isn't tuned for narrow.
- **MemoDetail:** pins a fixed `384px` chat pane beside the content; nothing stacks.
- **Modals / panels / FAB:** `AddMemoPanel` is a `296px` right-anchored panel; the `+` FAB sits at a fixed `16px` inset with no safe-area; `viewport` meta lacks `viewport-fit=cover`, so notch / home-indicator insets are ignored. Search overlay, Appearance panel, lightbox, onboarding: none are phone-tuned.
- **Brand mark:** the top-left logo is wired to `toggleSidebarCollapsed`, not navigation; it does not return you to the dashboard.
- **Touch:** Lenis smooth-scroll (`touchMultiplier:1.5`) hijacks native momentum scroll on every non-detail route.

Two facts shape *how* I fix this, not just *what*:

- The breakpoints already in the code are **scattered magic numbers** (720 / 900 / 1000 / 1100 / 1280 / 1500), defined independently in CSS and in JS. Bolting a mobile mode onto that scatter would make the drift worse (the thing ADR-001 warns against).
- **The desktop designs are still changing.** `MemoDetail` in particular will be reworked, and others may follow. So the mobile work must ride on the *same* components as desktop, not a hand-copied snapshot, or it rots the next time a page is redesigned.

### Decision

**Make every existing page responsive in place: one codebase, no separate mobile version, using one shared set of breakpoints.** Each page keeps the same components on every screen and simply re-lays-them-out by width. That is the whole point: when a page's desktop design changes later, **its mobile version changes with it for free**, because they are literally the same code. (This is what "connected, systematic adaptation" means in practice: not a second mobile app to keep in sync.)

Eight concrete decisions:

**1. One set of breakpoints, defined once, used by CSS and JS.** Three modes; everything keys off them:

| Token | Width | Mode |
|-------|-------|------|
| `sm` | ≤ 640px | **Phone** |
| `md` | 641–1024px | **Tablet** |
| `lg` | > 1024px | **Desktop** (today's layout) |

A `useBreakpoint()` / `useIsMobile()` hook (one `matchMedia` listener) is the single JS source; a small set of CSS tokens is the single CSS source. The scattered 720/900/1000/1100 literals get migrated onto these (the 1280/1500 grid-density steps stay, but as desktop-only refinements). No component re-types a raw pixel width again.

**2. Sidebar → off-canvas drawer below `lg`.** The rail leaves the flow and slides in from the left at `min(86vw, 320px)` over a dimmed, tap-to-dismiss scrim, opened by a hamburger in a slim **mobile top bar** (shown only below `lg`). It closes on route change, scrim tap, and Escape, and locks page scroll while open. The desktop rail and its collapse/expand (ADR-006) are untouched. *(A full-bleed `100vw` drawer was considered and rejected: no visible "tap to close" target; it reads as a page change, not an overlay.)*

**3. Logo → home, on every page.** The brand mark navigates to `/` in every state (wordmark on desktop, logo glyph in the collapsed rail, logo in the mobile top bar / drawer header), and closes the drawer on mobile. Collapse/expand moves entirely to the chevron control, so "go home" and "toggle the rail" stop being the same ambiguous button.

**4. Dashboard feed → one column on phones.** `useViewportColumns` returns `1` at ≤ `sm` and the masonry map gains `640: 1` (one column = a clean vertical stack). 2 columns at `md`, current behavior at `lg`. Cards must read well at full width.

**5. Sidebar player → fluid, never clips.** Fix the crop at the root: `min-width:0` on every flex child, `clamp()` sizes for the cover and transport, the time labels degrade to elapsed-only when very narrow, and the transport may wrap rather than clip. This retires the 90%-zoom workaround on *every* screen and gives the player the wider drawer on mobile for free.

**6. Every other page reflows to a single readable column on phones.**
- **Settings:** the bento grid and each card/row stack to one column; tap targets ≥ 44px.
- **Collections:** single column; the header row (title + edit toggle) stacks.
- **Ask:** single column; the question/answer area takes the full width; history stays hidden (already does at narrow).
- **MemoDetail:** content goes full-width and the secondary chat pane becomes a slide-over / sheet you open with a button, instead of a fixed side pane. *Because the rule is "main content + a secondary panel that collapses," it survives the planned desktop redesign: it is not pinned to today's `.om-detail-chat` markup.*

To keep these consistent (and to keep MemoDetail and Ask in step when their desktop layouts change), pages with a "main area + side panel" share one small two-pane helper that does the beside → slide-over → sheet switch by breakpoint, rather than each page reinventing it.

**7. Modals, panels, and the FAB go mobile-native.** Below `lg`, the Add-memo and Appearance panels become bottom sheets (near-full-width); the search overlay and lightbox already cover the screen and stay full-screen; the `+` FAB and all fixed chrome respect `env(safe-area-inset-*)` and clear the top bar. Add `viewport-fit=cover` to the meta tag.

**8. Touch is first-class.** Disable Lenis on touch / below `lg` so native scrolling and momentum work; enforce ≥ 44×44px hit targets on mobile controls.

#### Per-page plan (what changes, page by page)

| Page / piece | Desktop (`lg`, today) | Tablet (`md`) | Phone (`sm`) |
|--------------|-----------------------|---------------|--------------|
| Shell | Static rail + main | Top bar + drawer + full-width main | Top bar + drawer + full-width main |
| Sidebar | 260/76px rail | Drawer `min(86vw,320px)` | Same drawer |
| Brand / logo | Wordmark → home | Logo → home (top bar) | Logo → home (top bar) |
| Dashboard feed | 3–5 cols | 2 cols | **1 col** |
| Sidebar player | Rail player | Fluid, in drawer | Fluid, in drawer (no clip) |
| Settings | Bento grid | Stacked | Single column, ≥44px targets |
| Collections | Multi-col | Reflowed | Single column |
| Ask | Main + history | Single column | Single column |
| MemoDetail | Content + 384px chat | Content + chat slide-over | Single pane + chat sheet |
| Add / Appearance panel | Right panel (296px) | Bottom sheet | Bottom sheet |
| Search / lightbox | Full-screen overlay | Full-screen | Full-screen + safe-area |
| `+` FAB | bottom-right 16px | + safe-area | + safe-area, clears top bar |

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **A separate mobile version (second component set or route tree)** | Doubles the work and drifts: every desktop change has to be redone for mobile. My explicit goal is the opposite: change a page once, both sizes follow. One responsive codebase delivers that; two do not. |
| **Hand-tune each page's mobile CSS against its current markup** | Couples mobile to layouts that are still changing (esp. MemoDetail), so it breaks at the next redesign. Reflow by role (main + collapsible side panel) through a shared helper instead. |
| **Keep the static rail, just make it narrower on phones** | A fixed rail at any width still steals scarce phone space and crushes the feed. Off-canvas frees the full width and is the expected mobile pattern. |
| **Full-bleed `100vw` sidebar drawer** | No visible dismiss target; feels like navigating to a page. `min(86vw,320px)` over a scrim keeps "tap to close" and gives collections + player more room than the desktop rail. |
| **Just add a `640:1` feed breakpoint and call it done** | Fixes one symptom; leaves the sidebar, player crop, brand, and every other page unaddressed. The ask is the whole app. |
| **Fix the player crop with a phone-only media query** | The clip also happens under desktop zoom. The real fix is fluid sizing (`min-width:0` + `clamp` + wrap), which covers both. |
| **New scattered `max-width` literals per component** | That is exactly the 720/900/1100 drift already in the code. One token scale, read by CSS and the hook. |

### Consequences

- **New shared pieces:** a breakpoint token set (CSS) + `useBreakpoint()`/`useIsMobile()` hook (JS) as the one source of truth; a `MobileTopBar` + drawer scrim; a small two-pane helper for "main + side panel" pages (Ask, MemoDetail, future); `mobileDrawerOpen` state (reusing the store's already-present-but-unused `sidebarOpen`/`toggleSidebar`).
- **Every page gets a phone layout**, per the table above. This is whole-app responsiveness, not a single fix.
- **Desktop redesigns carry to mobile automatically** for any page built from the shared helper and the breakpoint hook: the explicit safety net for the MemoDetail rework and anything after it.
- **Player crop fixed at the root** (`min-width:0` + `clamp` + wrap): the 90%-zoom workaround is gone on every screen.
- **Brand navigates home everywhere;** collapse moves to its own control (`Sidebar.tsx` + mobile top bar).
- **Touch + safe-area:** Lenis off on touch; `viewport-fit=cover` + `env(safe-area-inset-*)` on fixed chrome; ≥44px targets.
- **Preserves ADR-005/006** (player internals, three-zone sidebar) and **ADR-008** (one `matchMedia` subscription, drawer animates with `transform`, no resize thrash, no reflow on open).
- **Coexists with the dashboard's infinite scroll** now landing on a parallel branch (`useInfiniteQuery` + a 1px `IntersectionObserver` sentinel, slim `load_only` payload): the sentinel rides the real `.om-main` scroll, so Lenis-off on touch leaves native scroll driving it, and the 1-column stack still positions it. When that branch merges, the "Dashboard uses `useQuery`" note above is superseded; the layout decisions are unaffected.
- **Status: designed, not yet built.** Nothing is built yet. Suggested order: (1) breakpoint source + shell drawer + top bar + logo-home; (2) feed 1-col; (3) player fluidity; (4) Settings / Collections / Ask single-column; (5) the two-pane helper + MemoDetail; (6) modals → sheets + safe-area. Each step is checkable against the per-page table.

---

## ADR-008: Performance is a request-path discipline. Never block the event loop, index for scale, keep liveness dependency-free

**Date:** 2026-06-04 · **Status:** Shipped · **Relates to:** ADR-002 (Ollama + headless browser ship inside the API image)

### Context

The home page sat on "Loading Memos…" for ~15s with only ~60 memos, and the
library is meant to grow into the thousands. The instinct was "the database will
not scale." Measurement said otherwise: the memo query was always ~0.5s. Two
unrelated blocking calls on the request path were the real cause, and both are
structural lessons worth recording.

1. **A synchronous filesystem walk froze the event loop.** The sidebar loads on
   every page and called `/api/stats`, which walked the entire `files/` directory
   (1.1 GB, slow over a Docker-for-Windows bind mount) with `Path.rglob()`
   **synchronously inside an `async def`**. uvicorn runs one event loop; a
   blocking call with no `await` stalls *every* concurrent request. So the fast
   `/api/memos` query queued behind a ~20s walk it had nothing to do with. The
   symptom looked like a slow memo load; the cause was an unrelated stats
   endpoint freezing the shared loop.

2. **Ollama was coupled to API liveness.** The container healthcheck hit
   `/api/health`, which probed Ollama with a 10s connect timeout, every 10s. A
   local LLM is optional: memos, search (FTS5), and browsing all work without it.
   But a down Ollama marked the whole API unhealthy and added a ~13s stall to the
   Settings page, plus ~8.6k pointless probes a day.

The reference checklist that prompted this (connection pools, indexes, N+1,
pagination, `SELECT *`) is generic Postgres-at-scale advice. Most of it did not
apply: this is a single-user local SQLite app, the list query already paginated
(`limit 50`) and already used `selectinload` (no N+1). The actual failure modes
were different, and naming them is the point of this record.

### Decision

Treat the request hot path as a shared, latency-sensitive resource. Five rules:

1. **Never run blocking work directly in an async handler.** Filesystem walks,
   synchronous DB drivers, heavy CPU, and subprocess calls go through
   `asyncio.to_thread` (or a background task). The single event loop is shared by
   every concurrent request; one un-awaited blocking call is a *global* stall,
   not a local one. `/api/stats` storage sizes now run via `asyncio.to_thread`.

2. **Expensive or rarely-needed data is opt-in and cached, off the default
   path.** Storage sizes became `?include_storage=true` (only the Settings page
   asks), computed in a thread and cached 60s. The sidebar's per-page call
   returns cheap `COUNT`s only. A page must never pay for data it does not render.

3. **Index every column the feed filters or sorts on, now, for thousands.**
   SQLite with no indexes is a full scan per query: fine at 60 rows, painful at
   thousands. Indexes are created idempotently on startup
   (`CREATE INDEX IF NOT EXISTS`), consistent with the no-migration-framework
   convention. The feed index matches the exact default query:
   `memos(is_deleted, recency_at DESC, created_at DESC)`, plus `memos(type)`,
   `memos(workspace_id)`, and `memo_collections(collection_id)` for the
   collection-filter join.

4. **Liveness is dependency-free; external dependencies are probed on demand,
   briefly, and cached.** `/api/ping` returns 200 with no external call and is
   what the container healthcheck uses, so an optional dependency can never mark
   the core API unhealthy. Ollama reachability is a separate concern, reported
   only by `/api/health` (Settings only), with a ~1.5s timeout and a 15s result
   cache. No background polling: lazy plus a short cache beats a timer that
   re-adds the probe noise I just removed.

5. **SQLite is the correct datastore for a single-user local app.** "Set up a
   connection pool" is the wrong lesson here: there is one user and one writer.
   The real bottlenecks are blocking the event loop and missing indexes, not
   connection exhaustion. I design for *this* app's shape, not a generic
   multi-tenant web service.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Move to Postgres + a connection pool** | Solves a problem this app does not have (concurrent multi-user connection exhaustion). Adds an external service to a local-first app. SQLite is correct for single-user; the fixes were loop-blocking and indexes. |
| **Keep storage sizes always-on in `/api/stats`, just make the walk faster** | The walk is inherently slow over a Windows bind mount and grows with the library. Any synchronous version still risks the loop. Opt-in + threaded + cached removes it from the hot path entirely. |
| **Background-poll Ollama every N seconds and cache the status** | Re-adds the exact timer noise (and log spam when down) I was removing. Lazy on-demand + a 15s cache gives fresh-enough status only when someone is looking. |
| **One `/api/health` for both liveness and Ollama status** | Conflates "is the API up" with "is the LLM up". A down optional dependency must never fail the container healthcheck or block the UI. Split into `/api/ping` (liveness) and `/api/health` (dependency status). |
| **Add indexes only once the library actually hits thousands** | They are idempotent and near-free at small scale. Waiting means the first slow day is a surprise; pre-indexing is cheap insurance. |

### Consequences

- Measured on real data (85 memos, 1.1 GB files): `/api/stats` 20s to 0.27s;
  `/api/memos` stays ~0.38s even while the storage walk runs in a thread (the
  loop is no longer frozen); `/api/health` with Ollama down 13s to 1.5s cold and
  0.2s cached; `/api/ping` 0.2s. The home page goes from ~15s to sub-second.
- New endpoint `/api/ping` (liveness). The Docker healthcheck points at it.
- `/api/stats` gains an `include_storage` flag; Settings passes it, the sidebar
  does not. Frontend `systemApi.stats(includeStorage?)`, and the sidebar
  `queryFn` is wrapped so React Query's context object is not passed in as a
  truthy flag.
- Startup creates feed indexes idempotently. No migration framework; consistent
  with the existing PRAGMA-guarded `ALTER`s.
- `OllamaClient.health_check()` is now a fast, cached probe (short timeout, 15s
  TTL, single host loop) rather than a double-probe with a 10s connect timeout.
- A reusable rule for new endpoints: if a handler touches the filesystem, a
  subprocess, or anything that can block, it goes through a thread; if it hits an
  external service, it gets a short timeout + a cache and never gates liveness.
- Shipped in PR #36 (squash-merged to `main`); changelog 2.2.0.

---

## ADR-007: AI Summary eligibility is one predicate, gated by memo type and audio kind (music excluded)

**Date:** 2026-06-03 · **Status:** Shipped · **Builds on:** ADR-001 (systematic per-type, centralized), ADR-003 (eligibility-predicate pattern), ADR-004 (where summary was born), ADR-005 (voice vs music split)

### Context

On-demand AI summary shipped inside ADR-004 as a *subsection* of the transcript
work ("On-demand, multi-mode summary"). That was the wrong home, and it left a
gap: unlike "Make it local" (ADR-003), summary never got an **eligibility
decision**. Its only gate, at both render sites, was *"does the memo have
text?"*:

- Frontend (`MemoDetail.tsx`): `{!isEditing && memo.content_text && <SummaryPanel/>}`
- Backend (`memos.py` `/summary`): `if not memo.content_text: raise 400`

So **any** memo carrying `content_text` showed the panel, including **music**.
A music memo with a pulled/transcribed track (or any text in `content_text`)
rendered an "AI Summary" with Timestamp/Insights/Essay modes. Summarizing a
song's transcript or lyrics is meaningless; the reported symptom ("AI Summary
shows where it shouldn't, e.g. a music memo") is the direct result of summary
never having an eligibility predicate the way every other capability does.

This is the same disease ADR-003 cured for "Make it local" (a panel appearing on
types where it has no meaning), left untreated for summary. ADR-005 already gave
me the exact tool to fix it cleanly: the `voice` vs `music` axis.

### Decision

**AI Summary eligibility is a single predicate, gated by memo type and (for
audio) the `audio_kind` sub-kind. Summary is NOT a property of transcript: it
applies to any text-bearing memo, so it gets its own ADR and its own
predicate**, mirrored on both ends so the API refuses exactly what the UI hides.

**1. One predicate, two mirrors, one editable type set.**

- Frontend: `canSummarize(memo)` in `lib/media.ts`, reading an exported
  `SUMMARIZABLE_TYPES` set.
- Backend: `can_summarize(memo)` in `core/classify.py`, reading a
  `SUMMARIZABLE_TYPES` set; consulted by the `/summary` endpoint.

Each is `has-text AND type-is-summarizable AND not-music`. Changing *which types*
qualify is a one-line edit to the set on each end. I wired it that way
deliberately so I can flip the policy fast without touching render logic.

**2. Music is always excluded; voice is always eligible.** The exclusion keys off
ADR-005's `audio_kind`: `music` (uploaded file or linked SoundCloud/Bandcamp/…)
never summarizes; `voice` (spoken-word mic recording) does. The frontend reuses
`isMusic(memo)`; the backend reuses `derive_audio_kind(memo)`. No new heuristic.

**3. Eligibility matrix.**

| Memo type | Summary? | Why |
|-----------|----------|-----|
| `video` | ✅ | transcript / platform description |
| `audio` · **voice** | ✅ | spoken word, summarizes like a talk |
| `audio` · **music** | ❌ | a song; transcript/lyrics aren't a summarizable argument |
| `article` / `link` | ✅ | extracted page text |
| `document` / `file` | ✅ | extracted text content |
| `code` | ✅ | a plain-language overview of a source file is useful |
| `note` | ✅ | low value (self-authored) but harmless; kept for now |
| `image` | ✅ (auto-skips) | no `content_text`, so `canSummarize` is false anyway |

The set currently admits **all text-bearing types except music**: the minimal
change that fixes the bug while removing nothing the user relies on. The set is
the lever for tightening later (e.g. dropping `note`).

**4. Mode availability is unchanged and now consistent.** `timestamp` mode stays
offered only for `video`/`audio`; since music can no longer reach the panel, the
only audio that gets timestamp mode is voice, whose transcript carries the inline
`[mm:ss]` markers the mode depends on (ADR-004). No mode can be requested for
content that lacks its prerequisite.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Keep the `content_text`-only gate** | The root bug: "has text" is not "is summarizable". Music has text; it still must not summarize. |
| **Hardcode `type !== 'audio'`** | Wrong: it would kill summary for *voice* memos (spoken word, the ideal summary target) while a future music-only carve-out would still be scattered. The axis is voice/music, not the audio type. |
| **Scatter the type checks at each render site** | Violates ADR-001/ADR-003: gates drift. One predicate per end, read everywhere. |
| **Frontend-only gate** | The API would still summarize music if called directly; defense-in-depth and parity with the existing `content_text` backend check argue for mirroring. |
| **Leave it folded under ADR-004** | The omission of an eligibility decision is *why* the bug existed. Summary spans articles/links/docs, not just transcripts, so it earns its own record. |

### Consequences

- The reported leak is structurally impossible: a music memo can never render the
  AI Summary panel, and the `/summary` endpoint 400s if called for one.
- New predicates `canSummarize` / `can_summarize` join `canMakeLocal` /
  `canTranscript` as the family of single-source eligibility gates.
- Which types qualify is one editable set per end: quick to change, by design.
- Voice memos keep summary; nothing else text-bearing loses it.
- **Adjacent, not addressed here:** music is still *transcribable*
  (`canTranscript` admits all audio). Transcribing a song is the same kind of
  mismatch; a follow-up may gate transcription by `audio_kind` too. ADR-005
  already defers real lyrics support to its own track.

---

## ADR-006: Sidebar is a fixed three-zone column; only the collections list scrolls

**Date:** 2026-06-03 · **Status:** Shipped · **Relates to:** ADR-005 (the sidebar hosts the now-playing player)

### Context

The sidebar was a single flex column with `height: 100vh; overflow-y: auto`: the
**whole** sidebar was the scroll container. That made bottom-anchored elements
(the foot, and after ADR-005 the now-playing player) behave as scrolling content,
not pinned sections. Pinning them with `margin-top: auto` "worked" but, in a column
flex, auto margins absorb **all** remaining free space, so a large empty gap opened
above the player whenever the content was short (the common case). A coding-agent
handoff (`sidebar-handoff.md`) diagnosed this precisely.

Separately, the desired behavior is that **only the collections list scrolls**:
search, primary nav, the Pinned section, and the "Collections" header should stay
fixed, not scroll away with the list.

Lenis smooth-scroll is bound to `.om-main` (the routed content), **not** the
sidebar, so the sidebar scrolls natively; Lenis does not hijack it.

### Decision

Model the sidebar as a **fixed-height, non-scrolling flex column** with explicit
zones, and put scrolling on exactly one inner element:

| Zone | Elements | Scroll? |
|------|----------|---------|
| Top (fixed) | brand head · search · nav · Pinned section · Collections header | no |
| Middle (the only scroller) | `.om-sidebar-scroll` → the collections list | **yes** |
| Bottom (fixed) | `SidebarPlayer` · foot (theme + avatar) | no |

- `.om-sidebar` is `height: 100dvh; overflow: hidden`; it never scrolls itself.
- `.om-sidebar-scroll` is `flex: 1 1 auto; min-height: 0; overflow-y: auto` and is
  **always rendered** (even collapsed, where it's empty) so it owns the flexible
  space and naturally pins the player + foot to the bottom, with **no `margin-top:auto`**.
- The "Collections" header is a standalone fixed row above the scroller; only the
  list rows scroll under it.
- `data-lenis-prevent` is set on the scroller defensively, though Lenis is scoped
  to `.om-main` and does not touch the sidebar today.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Keep the whole sidebar scrollable + `margin-top:auto` on the player/foot** | Auto margins eat all slack → large empty gap above the player; the reported bug. |
| **Scroll the entire middle (nav + pinned + collections)** | Search/nav/Pinned/labels scroll away. I want them fixed; only the collection list should move. |
| **`position: fixed` player pinned to the viewport** | Introduces overlap + width/offset compensation against the animated-width sidebar; brittle. |

### Consequences

- Player + foot stay visually pinned to the bottom with no gap, expanded or collapsed.
- Only the collections list scrolls; everything else is fixed.
- New classes: `.om-sidebar-scroll`, `.om-collections-head`. `.om-sidebar` loses its
  own scroll. No JS layout math, pure flexbox.

---

## ADR-005: Audio is a first-class media experience. Voice vs music split, local-first pull-first player

**Date:** 2026-06-03 · **Status:** Shipped · **Builds on:** ADR-001 (whole-type scope), ADR-003 (tiered capture), ADR-004 (non-destructive transcript)

### Context

Audio was the runt of the media types. Three different things all collapsed into a
single undifferentiated `type: 'audio'`:

1. **Voice memos:** mic recordings made in-app (spoken word, transcribe-on-save).
2. **Uploaded music:** a local `.mp3` / `.flac` / `.wav` the user dropped in.
3. **Linked music:** a track pulled from SoundCloud / Bandcamp / Mixcloud / Audius.

Nothing in the schema told them apart, so every render site had to guess from a
fragile filename heuristic (`title LIKE 'Voice memo%'`). That blocked any
treatment that should apply to *music but not voice* (cover art, an album-style
player, ambient glow) or *voice but not music* (the waveform the user explicitly
loves). Playback itself was a top-right pill (`HeaderAudioPlayer`) bolted onto the
app shell, with no presence in the sidebar where the rest of the app's navigation
lives, and no way to tell what was playing once the player was dismissed.

Two latent bugs made linked audio actively hostile:

- **Bug 1: audio hosts mistyped `video`.** SoundCloud/Bandcamp/Mixcloud live in
  the extractor's `_VIDEO_DOMAINS` (yt-dlp pulls them like any other site). When
  yt-dlp's metadata probe *failed* at save time (rate-limit, transient network, a
  momentary host change, all common for SoundCloud), `extract_video` fell back to
  a hardcoded `type = "video"`. A `video`-typed SoundCloud memo has no inline
  player (it is not in the video embed registry) and every audio render path is
  gated on `type === 'audio'`, so the detail page rendered **nothing**: a dead
  end produced by a transient hiccup, affecting *every* audio host, not one.

- **Bug 2: the live platform embed was hidden whenever auto-download was on.**
  The SoundCloud/Mixcloud widget ("listen at the source") only rendered when
  `localize_status` was unset, i.e. auto-download OFF. With auto-download ON (the
  default), the user never got the live reference, and a `localize_status: done`
  state that somehow lacked a `file_path` fell through every branch to nothing.

### Decision

Promote audio to a first-class, deliberately designed experience, modeled on
**two orthogonal axes** so I never again conflate distinct concerns:

| Axis | Field | Drives |
|------|-------|--------|
| **Kind** | `audio_kind` ∈ {`voice`, `music`} | *Behavior*: waveform vs cover art, inline card player, ambient glow |
| **Origin** | `file_path` (local) vs `source_url` (remote) | *Playback path*: the `<audio>` engine vs platform iframe |

**1. `audio_kind` is an explicit column, set at ingest, read through one predicate.**
The mic recorder posts `audio_kind=voice`; every other audio (uploaded file or
linked pull) defaults `music`. A PRAGMA-guarded migration backfills existing rows
(`title LIKE 'Voice memo%'` and no `source_url` → `voice`, else `music`). The
frontend reads it through a single `audioKind(memo)` predicate in `lib/media.ts`
(with the same heuristic as a fallback for un-migrated rows). No scattered `if`s.

**2. The player is local-first and pull-first.** The engine is one shared HTML5
`<audio>` element (in `AudioPlayerProvider`, survives navigation). It can only
play a real media resource the browser can load: a local file at
`/api/memos/:id/file`. Platform "embeds" (`w.soundcloud.com/player/…`) are *whole
web pages*, not streams; the real stream URLs are signed and CORS-locked, so
`<audio src>` can never point at them. Therefore **linked audio must be pulled to
a local file (yt-dlp) before the player can touch it.** Auto-download (default ON,
already wired in `ingest.py`) makes this invisible: a saved SoundCloud link
localizes in the background and *upgrades itself* into the rich player within
seconds. Until then, and whenever a host is unpullable or auto-download is off,
the platform **iframe is the graceful live-reference fallback**, never a dead end.

**3. Classification knows audio hosts (Bug 1 fix), centrally.** A single
`AUDIO_HOSTS` set (backend) is consulted by both `extract_video`'s failure
fallback and `derive_memo_type`: a known audio host classifies `audio` **even when
yt-dlp fails**. The frontend mirror is `lib/audioPlatforms.ts`: a registry of
host → brand glyph + embed URL + can-localize, exactly parallel to the video
`lib/platforms.ts` (ADR-001). Card, detail, and player all read the registry; a
new audio host is added in one place.

**4. Remote audio never dead-ends (Bug 2 fix).** The detail page always offers a
listen path for a remote audio memo: the live platform embed (when the registry
has one) plus "Make it local", independent of `localize_status`. A localized memo
plays its local file *and* still exposes the source embed as a reference.

**5. The player lives in the sidebar, and music gets the full treatment.**
`HeaderAudioPlayer` (top-right pill) is removed. A `SidebarPlayer` sits in the
sidebar foot: cover, title, subtitle, scrubber, and a transport of
**repeat-one · play/pause · pin** (the single-item focus replaces next/prev; no
queue yet). When the sidebar is collapsed it shrinks to a cover thumbnail with a
progress ring so "something is playing" survives the tuck-away. Two treatments are
**music-only** (gated on `audioKind === 'music'`), leaving voice memos exactly as
they are (waveform tile + button, which users love):

- **Inline card player:** the active music card flips to an in-card player via
  an absolute overlay (the delete-confirm `om-card-confirm` mechanism) **at the
  card's existing size, no resize, no cover zoom**, so the grid never jumps. The
  cover stays crisp; a bottom→top gradient (cover-mood tint + a backdrop blur
  masked to the lower zone, "blur behind the controls") carries the transport +
  title. An earlier version that zoomed/blurred the whole cover was rejected as
  jumpy.
- **Cover-mood tint:** both players (and the aurora) are tinted to the artwork's
  dominant color, extracted client-side with a tiny canvas in `lib/coverMood.ts`
  (no dependency; covers are same-origin so the canvas is never tainted; failure
  falls back to theme tokens). White controls over the mood color, like a proper
  now-playing surface.
- **Aurora glow:** a faint aurora-borealis halo behind the playing music card,
  tinted from the cover mood, bleeding just past the card edge. Two color blobs on
  `::before`/`::after` drift independently (coprime periods, opposite directions)
  under a heavy blur, so it shimmers organically and never visibly loops. (A
  single radial *mask* was tried first; it faded to transparent before the card
  edge and hid the whole ring.) Honors `prefers-reduced-motion`.

**5a. The OS media keys drive the player (Media Session API).** The shared engine
registers `play`/`pause`/`seek*` handlers on `navigator.mediaSession` and publishes
`MediaMetadata` (title / artist / cover) per track, so the keyboard play/pause key
and the lock-screen / notification transport control playback and show the artwork.

**5b. The sidebar is a fixed three-zone column.** `.om-sidebar` is
`height:100dvh; overflow:hidden` (it does **not** scroll); only a middle
`.om-sidebar-body` scrolls (nav / pinned / collections); the now-playing player +
foot are the non-growing bottom zone. This pins the player to the bottom with no
`margin-top:auto` gap (auto margins in a column flex absorb all free space, and
the previous approach left a large void above the player).

**6. Lyrics are explicitly deferred** (documented in the roadmap, no code).
Future work, free sources only (local-first): **LRCLIB** (open synced-lyrics API,
no key), embedded ID3 `USLT`/`SYLT` tags read from uploaded files, `lyrics.ovh`
as a plain-text fallback. No paid lyrics API, ever.

#### Scope boundary: video

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
| **Keep deriving voice vs music from the filename** | Fragile: breaks on rename, on non-English titles, on any uploaded track literally named "Voice memo…". A real column is the single source of truth. |
| **Leave the player in the header** | The sidebar is where navigation + pinned items live; a collapsed-sidebar now-playing cue is impossible from a top-right pill; and the inline-card / aurora story wants the player conceptually "inside" the library, not floating over it. |
| **Stream linked audio directly in the `<audio>`** | Impossible for the platforms that matter: their stream URLs are signed + CORS-locked. Pull-first is not a preference, it is the only correct path; auto-download hides the cost. |

### Consequences

- New column `audio_kind` (migration `backend/migrate_audio_kind.py`,
  PRAGMA-guarded ALTER + backfill). Exposed in the memo API + `Memo` TS type.
- New `lib/audioPlatforms.ts` registry; `audioEmbed` moves there. Adding a host
  (e.g. Audius) lights up card glyph + detail embed + player simultaneously.
- A transient yt-dlp failure can no longer turn a SoundCloud memo into a dead
  `video` page; audio hosts are structurally `audio`.
- Remote audio always has a listen path (live embed and/or local file): the
  reported "play button leads to a page with nothing" is structurally impossible.
- `HeaderAudioPlayer` is deleted; `SidebarPlayer` replaces it. The shared engine
  gains repeat-one state.
- Music cards gain an inline player + aurora; voice cards are untouched.
- Repeat-one + pin replace next/prev; a real queue/playlist is future work.

---

## ADR-004: Transcript extraction is decoupled from file capture (non-destructive, caption-first)

**Date:** 2026-06-03 · **Status:** Shipped · **Supersedes:** the transcript portion of ADR-003

### Context

ADR-003 modeled "Make it local" as a single tiered action keyed off memo type,
with three download modes: `video`, `audio`, and `audio_transcript`. In practice
this fused **three distinct user intents** into one destructive action:

1. *Get a transcript*: the user wants the **text** of a talk; audio is only a
   means to that end.
2. *Save the video offline*: keep a playable local copy.
3. *Convert a long video to an audio-only "podcast"*: deliberately drop the
   video.

Because the only transcript path was `audio_transcript`, asking for a transcript
**downloaded the audio and flipped `memo.type` from `video` to `audio`**
(`ingest.localize_memo_task`: `memo.type = result["type"]`). The inline video
embed is gated on `type === 'video' && !file_path`, so the flip silently
**destroyed the video**: the user lost their video to get its text. A transcript
is a *property* of a memo, not a memo type; coupling the two was the root error.

### Decision

**Transcript extraction is a separate, non-destructive capability that never
changes a memo's `type` or `file_path`.** It is independent of "Make it local"
(file capture). Two orthogonal axes:

- **Transcript** (`POST /memos/:id/transcribe` → `core/transcript.py`): produce
  text only. The memo keeps its type and its remote embed.
- **Make it local** (`POST /memos/:id/localize` → `core/localize_media.py`):
  capture a local file. `mode='audio'` remains an **explicit** video→audio
  podcast conversion (the third intent above), now clearly labeled and warned in
  the UI, never a transcript side door. The `audio_transcript` mode is removed.

#### Transcript pipeline: caption-first, STT fallback

`core/transcript.py` `get_transcript(url)`:

1. **Captions:** `yt-dlp --skip-download --write-subs --write-auto-subs
   --sub-format vtt` pulls the source's own subtitles **without downloading the
   media**. Fast, free, no Whisper. The VTT is parsed (inline word-timing tags
   stripped, rolling auto-caption duplicates de-overlapped) into text with inline
   `[mm:ss]` markers.
2. **STT fallback:** if the host exposes no captions, download the audio to a
   **temp** directory, run faster-whisper (now emitting per-segment `[mm:ss]`
   markers), then **delete the temp file**. The memo's `type`/`file_path` are
   untouched: a video memo stays a video memo.

The result is stored in `content_text` (so it embeds for RAG + is searchable),
with `transcript_source` recording `captions` vs `stt` for a UI badge. A local
file present routes to direct Whisper STT (`transcribe_memo_task`); remote-only
routes to the caption-first extractor (`transcript_memo_task`).

#### On-demand, multi-mode summary

Summaries are generated lazily per mode, each a single Ollama call fed the
**full** transcript/content (`core/rag.py` `SUMMARY_MODES`):

- **`timestamp`:** chronological bullet outline anchored to the inline `[mm:ss]`
  markers (only offered for video/audio, since it depends on those markers).
- **`insights`:** key takeaways as bullets (mirrored to `ai_summary` for
  back-compat).
- **`essay`:** flowing prose.

Results cache per-mode in the `summaries` JSON column so switching back is
instant. Inline timestamps live **in the transcript text itself** (no separate
segments table), which is what makes the timestamp mode possible without extra
storage.

#### Scope: the whole video type (ADR-001)

Both caption pull and STT run through yt-dlp, which abstracts every video host,
so this lights up for YouTube, Vimeo, Dailymotion, TikTok, etc. simultaneously.
`canTranscript(memo)` in `lib/media.ts` is the single predicate. Hosts with no
captions fall back to STT; hosts with neither (auth-walled/private) degrade to an
error state with "open original" still available, never a dead end.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Keep `audio_transcript` (download audio + flip type)** | The root bug: destroys the video to get its text and conflates three intents. |
| **Always Whisper STT, ignore host captions** | Slower and heavier for the common case; YouTube/Vimeo already publish accurate captions for free. STT is the fallback, not the default. |
| **Separate `transcript_segments` JSON column for timestamps** | More storage + a migration for data that rides for free as inline `[mm:ss]` in the text the model already reads. I made the transcript-first call instead. |
| **A second inline "audio tab" alongside the video** | Treats the symptom. The real fix is to stop the type flip so the video never disappears in the first place; the existing Description/Transcript tabs then suffice. |

### Consequences

- A video memo can gain a transcript **and** keep its inline player: the
  reported bug is structurally impossible now (transcript never sets
  `type`/`file_path`).
- New columns: `transcript_source`, `summaries` (migration
  `backend/migrate_transcript_summary.py`, PRAGMA-guarded ALTER TABLE).
- "Make it local → Audio only" is now an explicit, warned podcast conversion:
  the long-video→podcast workflow is preserved, just no longer the transcript
  path.
- Summary is now three modes instead of one; the single `ai_summary` is kept in
  sync for the `insights` mode so nothing downstream breaks.
- Memos already flipped to `audio` by the old `audio_transcript` path are not
  auto-migrated; they can be re-saved or repaired manually.

---

## ADR-003: "Make it local" visibility is gated to remote, localizable media (tiered capture)

**Date:** 2026-06-02 · **Status:** Shipped

### Context

A saved URL can be captured in several different ways depending on what it is.
The "Make it local" panel (which downloads a remote media item to a local file
via yt-dlp) was appearing on memo types where it is meaningless (articles,
links, images, notes, documents), cluttering the detail page and confusing
users. "Make it local" is only meaningful for a remote, yt-dlp-pullable media
item that is not already stored as a local file.

At the same time, different memo types require different capture strategies at
save time. Lumping all URLs under a single action model obscures these
differences and creates implicit dead ends for non-media types.

### Decision

OpenMemo uses a **tiered capture strategy** keyed off memo type. "Make it
local" is exactly **one tier**, not a universal action available everywhere:

| Memo type | Capture strategy | Make it local? |
|-----------|-----------------|----------------|
| `link` / `article` | Server-side scrape (headless Chromium, see ADR-002): content + hero image captured at save time | No |
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
| **Show "Make it local" on every memo type** | Meaningless and misleading on non-media types: implies you can "download" an article or a note. Adds clutter without value. |
| **Scatter per-type `if` conditionals across components** | They drift out of sync as the codebase grows; violates the single-source principle established in ADR-001 (memo-type changes must be systematic across the whole type, not scattered per-provider). |
| **Separate "download" button per type with no shared predicate** | Same fragmentation risk; harder to test; requires updating multiple render sites when the localize eligibility rules change. |

### Consequences

- One predicate (`canMakeLocal`) is the single source of truth for panel
  visibility; updating it propagates correctly to every render site with no
  drift.
- Non-qualifying memo types fall back to their type-appropriate action (Open
  original, image preview, editable note, Download original). No memo type is
  a dead end.  Satisfies the graceful-fallback rule from ADR-001.
- The tiered model makes the capture strategy for each memo type explicit and
  auditable in one place (this ADR + the predicate), rather than implicit in
  scattered component logic.
- New yt-dlp-supported types (e.g. a future `podcast` type) are opted in by
  updating `canMakeLocal` alone; everything else is unchanged.

---

## ADR-002: Self-hosted headless Chromium replaces Microlink for link extraction

**Date:** 2026-06-02 · **Status:** Shipped

### Context

OpenMemo saves any URL as a link memo by fetching the page and extracting its
title, description, thumbnail (via `og:image`), and readable content. Two
categories of page resist a plain HTTP fetch:

1. **Antibot / JS-challenge pages:** sites protected by Cloudflare's *managed
   challenge* return HTTP 202 with a tiny JavaScript stub. The stub has no
   OpenGraph data; the real DOM only appears after the challenge JS runs in a
   real browser. Examples: Dribbble, Behance.

2. **JS-rendered SPAs:** pages whose `<head>` metadata is injected by
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
  ones I needed it for.

OpenMemo is **local-first** and must not depend on a paid third-party API.

### Decision

Embed a self-hosted **headless Chromium** (via Playwright) directly in the
`openmemo-api` Docker image. When a plain HTTP fetch is not enough, the app
drives a real browser that executes challenge JS and delivers the fully rendered
DOM (including real `og:image` and readable content) with no third-party API,
no key, and no per-site rate limit.

Microlink was **removed entirely** from the codebase (no fallback, no free
tier).

#### How it works

`backend/core/extractor.py` `extract_url()` implements a three-stage chain:

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
   `httpx` request that reads only meta tags, for pages that block the API
   path but serve HTML fine to a real user-agent. This is a cheaper fallback
   before the final safety net.

4. **Preview-unavailable card** (final fallback). A memo is still created with
   the source URL intact so the user can open the original: a save never
   dead-ends.

`backend/core/headless.py` is a **lazy singleton**: Chromium launches on first
use, stays warm across requests (each render gets its own incognito
`BrowserContext`, closed after the request), and is shut down cleanly via
`close_browser()` called from the FastAPI app lifespan in `backend/main.py`.
If Playwright or the binary is unavailable, `render_page()` returns `None` and
the chain degrades to the plain-fetch path: the feature is purely additive.

The browser binary is installed in the Docker image via:

```dockerfile
RUN python -m playwright install --with-deps chromium chromium-headless-shell
```

`playwright>=1.49.0` is declared in `backend/requirements.txt`; the OS
libraries are pulled by `--with-deps` on the slim Debian base.

#### Scope boundary

This solves **antibot** (Cloudflare managed challenge) for **public** pages.
It does **not** defeat **auth walls**: private Facebook photos, logged-in
Instagram posts, and similar content require a valid session cookie that no
anonymous browser can supply. Those links still need the browser extension.
Antibot solved ≠ auth-wall solved.

### Alternatives considered

| Option | Why rejected |
|--------|--------------|
| **Microlink PRO** (paid API) | Violates local-first principle; OpenMemo must work without any cloud API or subscription. |
| **`curl_cffi` TLS impersonation** | Tested: the managed JS challenge is not a TLS fingerprint problem; both `curl_cffi` and `cloudscraper` still receive HTTP 202. A real JavaScript engine is required. |
| **`browserless` sidecar container** | The underlying engine Microlink uses; cleaner isolation, but adds ~1 GB extra container and more infrastructure orchestration. Embedding Chromium in the API image is simpler and sufficient for a single-user local app. |
| **Ignore antibot sites / extension-only** | Leaves Dribbble, Behance, and similar sites permanently broken as link memos. I rejected it; these are legitimate design-inspiration sources. |

### Consequences

- **Image size:** `openmemo-api` grows by approximately 400 MB (Chromium
  binary + required OS libraries installed via `--with-deps`).
- **Ingest latency:** saving a bot-walled link now takes roughly 10 s while
  the headless render completes. The render runs in-request synchronously; a
  possible future improvement is to move it to the existing background ingest
  task.
- **Container flags:** Chromium runs with `--no-sandbox` and
  `--disable-dev-shm-usage` inside the Docker container, as required when
  there is no user-namespace sandbox. This is standard and expected for
  containerized headless browsers.
- **No third-party dependency for link scraping:** the entire extraction chain
  (`extract_url` → `_minimal_link` → `render_page` → `_parse_html`) runs
  locally. A save works fully offline (except for the actual page fetch).

---

## ADR-001: Memo-type changes are systematic across the whole type, not per-provider

**Date:** 2026-06-02 · **Status:** Shipped

### Context

Every memo has a *type* (`video`, `audio`, `link`, `image`, `document`, …), and
each type spans many *providers* / hosts:

- **video:** YouTube, Vimeo, Instagram, TikTok, Facebook, X, VK, Dailymotion,
  Twitch, Streamable, …
- **audio:** SoundCloud, Bandcamp, Mixcloud, …

Repeatedly, a feature was built for one provider and hardcoded to it, silently
breaking every other provider of the same type:

- The detail-page video embed handled **only YouTube**. Vimeo, Instagram,
  TikTok, VK and every other host got no inline player and a dead
  "No preview available" in the lightbox.
- The minimal video card showed a brand glyph only for YouTube/Vimeo; every
  other host fell back to a generic "video file" icon.

A user who never touches YouTube (say someone who only saves VK or Vimeo video)
experiences the feature as broken, even though "it works" for the provider it
was built against. A "YouTube embed" task is really a **video-type** task; an
"audio player" task is really an **audio-type** task.

### Decision

When a feature or change touches one provider/variant of a memo type, the
**default scope is the entire memo type** (every provider of that type), not
the single provider that prompted the work. Provider differences are routed
through a **shared abstraction**, never inlined as per-host conditionals
scattered across render components.

Operating rules:

1. **Default scope = the memo type.** "Add a video embed" means *all* video
   hosts. "Restyle the audio player" means *all* audio sources: change it for
   SoundCloud, change it for Bandcamp and Mixcloud too.
2. **Centralize provider differences.** One registry/abstraction
   (e.g. `frontend/src/lib/platforms.ts` for video hosts) consumed by every
   render site: card, lightbox, detail. No `if (host === 'youtube')` sprinkled
   through components.
3. **Confirm scope before starting.** If a request names a single provider,
   **stop and confirm with the user before coding**: surface a short plan and
   ask: *"this touches the `<type>` memo type; apply to all `<type>` providers,
   or just `<provider>`?"* Do not begin until the user confirms. Keep the user
   in the loop on scope.
4. **Graceful fallback is mandatory.** A provider I did not explicitly wire
   must still degrade safely (Open original / Make it local), never a dead end.
   This guarantees robustness for hosts I haven't special-cased (e.g. VK).

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
