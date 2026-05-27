# Changelog

All notable changes to OpenMemo are documented here.

---
## [1.8.6] - Unreleased

### Added

- 📌 **Pin from card hover (memos + collections)** — pinning is no longer detail-only. MemoCard grows a pin button left of delete in `om-card-actions`; pinned cards keep the accent button visible permanently. CollectionsPage cover gains an `.om-coll-pin` button at top-left, mirroring the same accent treatment. Both flows invalidate `['memos','pinned']` and `['collections']` query keys, so the Sidebar's Pinned section refreshes instantly.
- 🎬 **Video upload thumbnails** — new `backend/core/video.py:extract_video_thumbnail` shells out to ffmpeg (`-ss 1.0 -frames:v 1 -vf scale=480:-2 -q:v 4`) to grab a still frame from any uploaded video. Falls back to frame 0 for clips shorter than a second. Best-effort: when ffmpeg isn't on PATH the video memo simply renders without a thumb (no error). Wired into the existing `process_file_memo` background task.
- 👤 **Profile editing — name, avatar, email, mailing list opt-in** — `app_settings.json` gains `display_name`, `email`, `avatar_data_url`, `mailing_list_consent`; `SettingsPatch` accepts them via the existing `PUT /api/settings`. New Profile SettingCard at the top of the left column with an avatar picker (resized client-side to a 256² JPEG data URL so the JSON stays small), inline name/email inputs that save on blur, and an opt-in checkbox for the creator's personal updates list. Sidebar foot now reads `display_name` + `avatar_data_url` via React Query (`['settings']`), falling back to "openMemo" / initials when unset.
- 🌌 **Living-cell intro animation** — the welcome screen's single placeholder orb is replaced by four blurred blobs on independent 14/17/19/22s loops with `mix-blend-mode: screen` and `filter: blur(28px)`. Calm, slow, centred. Honours `prefers-reduced-motion`.
- 🌊 **Smooth scroll (Framer-style)** — Lenis 1.3 is wired into `.om-main` with a 1.1s exp-out easing curve. New `.om-main-inner` wrapper holds the scroll content. CSS imported from `lenis/dist/lenis.css`.

### Changed

- 🌅 **Theme toggle — sunset/sunrise behind the memo grid** — replaces the fullscreen `z-index: 9999` overlay with a `z-index: 0` layer that sits BEHIND the cards. Going dark, a purple-tinted dusk rolls in from the bottom; going light, a warm dawn lifts from the top. Implemented as a size-animated radial gradient driven by a `--r` CSS variable (3% → 180%) so the leading edge softly fades to `transparent` — no hard clip-path boundary. Sequential phases: 0–6s tidal grow, 0–12s opacity fade (the first 6s stay fully opaque, then fade), so a freeze-frame inspection is easy.
- 🧭 **First-time tour now gates progress on a real `+` click** — the `Capture anything` step disables Next until the user actually opens the add-memo panel. The coach layer becomes `pointer-events: none` while gated so the FAB receives the click; the card buttons keep `pointer-events: auto`. Once the panel opens, the spotlight smoothly morphs from the FAB onto the panel via existing `transition: all .25s`. New `TourStep` fields: `gate`, `morphTarget`, `gateBody`.
- 🎨 **AppearancePanel — slimmer, sidebar-aware, opens on the LEFT** — the panel is now anchored on the left side of the canvas, with the horizontal offset wired to the sidebar width (260px expanded / 76px collapsed) via a compound `.om-add-panel.om-ap-panel` selector and an `.om-app.sidebar-collapsed` ancestor rule. Dropped the `1×` animation-speed button (default bumped to `2×`) and the `Rich` card-style option (the related `[data-card="rich"]` CSS is also gone). The remaining cardStyle options use the `.two` segment modifier so Min + Hybrid fill the row evenly. Existing localStorage values for `blobSpeed: 1` and `cardStyle: 'rich'` are migrated to `2` and `'hybrid'` on load.
- 🌀 **Background blob animation ~3× more visible** — `@keyframes omIridescent` rebuilt: translate amplitude ±6–7%, rotate ±6–7°, scale up to 1.18, with five keyframes instead of four. Default speed change to `2×` pairs with this so motion is actually felt without being distracting.
- 🪪 **Sidebar wordmark only — logomark dropped** — removed the small `O` avatar from the sidebar header. `.om-brand-name` size bumped 15 → 19px so the wordmark carries the slot on its own.
- 🎨 **Contrast-aware accent text colour** — new `--accent-text` CSS var derived from accent luminance (light accents → dark text, dark accents → white). Install-extension button and other accent-painted controls now read from it instead of hardcoding `#fff`, fixing invisible text on the light-grey accent. Computed in `applyTweaks` via a new exported `luminance(hex)` helper.
- 🧬 **Settings layout polish** — Profile card lives at the top of the left column. Built-with hover panel now keeps the last hovered description after `mouseleave` (no clear) and locks `min-height: 112px` so neighbouring cards don't shift. Danger zone is nested under Built-with in the right column.
- 🔃 **Single, recency-driven sort order** — dropped the four sort modes (Recent / Oldest / Title / Custom) from the dashboard and the appStore. There is one sort, always: `desc(recency_at)`. New `memos.recency_at` TIMESTAMP column with a migration that backfills from `created_at`. Drag-to-reorder writes `recency_at = NOW − (i × 1s)` per card; a brand-new memo created later still lands on top because its `recency_at = NOW()` is greater than every rewritten value. New `PUT /api/memos/{id}/recency` replaces the old `/sort` endpoint; the frontend `sortMode` state, `SortMode` type, sort dropdown UI, and `memoApi.updateSort` are all gone.

### Fixed

- 🪟 **Edit-collection modal hidden behind the FAB + add-panel** — `.om-modal-backdrop` `z-index` 60 → 80 so it sits above the FAB (60), AddMemoPanel (61), and the `.om-fab.open` close affordance (62). Modal scrim now properly covers everything underneath.
- 📌 **Pinned memos in the sidebar** — pinning is no longer collection-only. New `memos.pinned BOOLEAN DEFAULT 0` column (lightweight migration), `PUT /api/memos/{id}/pin`, `GET /api/memos/pinned/list`. The Sidebar's Pinned section now renders pinned collections **and** pinned memos in one group; clicking a pinned memo navigates straight to its detail page. MemoDetail gains a "Pin to sidebar" / "Unpin" pill in the action row. Drag-to-reorder within the Pinned section is intentionally out of scope for this commit (existing `sort_order` column orders the list; UI for manual reorder will land next).

### Changed

- ❤️ **Settings "Built with" card rebuilt with intent** — lead paragraph now thanks the OSS authors openly; tiles still link to each project but on hover/focus a single description slot below the grid updates with a one-line "what it does" + a "Learn more →" link out, instead of every tile being a blank pill. Expanded the entry list (added MDXEditor, yt-dlp) and gave every entry a real description. Moved the Creator card *above* the Built-with card so the "Made by" attribution leads, and equalised the footer divider's vertical space (24 px above + 24 px below the rule instead of 28 px / 8 px) so the divider sits symmetrically.

### Added

- 🎞️ **Local video preview + media controls in MemoDetail** — image and local video memos now share a `MediaPreview` component with three affordances: a hover-revealed Theater toggle (top-right) that expands the preview to full content width, a Fullscreen button (browser native fullscreen API), and click-to-Lightbox on images (Esc or click-outside closes). Local-file videos (`type: video` with a `file_path`) finally render at all — previously only YouTube embeds did.

### Fixed

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

### Added

- 🗂️ **Accept any file type** — the upload handler no longer enforces an extension allow-list or magic-byte gate (images are still sanity-checked). Files are categorized into image/audio/video/document/code/file; unknown types become `file` and show a file icon + extension badge on the card.
- 💻 **Code file handling** — source/script files are detected as a `code` memo type, stored as text and rendered as a fenced, language-tagged code block. Hardened comment + read-only handling guarantees uploaded files are never executed/interpreted.
- ⚙️ **Configurable max upload size** — new `GET/PUT /api/settings` (JSON-persisted) and a Settings → Uploads card to set the per-file limit (default 5 GB; user can raise it up to 1 TB or set `0` for effectively uncapped — this is a local-first app, the user owns the disk).
- 🛟 **Huge-upload disclaimer** — Add Memo's file picker now warns before sending anything ≥ 1 GiB: total size, that ingestion and embedding will take a while, and a reminder that files stay on the user's machine. One-click confirm/cancel.
- 🧪 **Unknown extension passthrough** — Uploading a file with an extension (or no extension) the categorizer has never seen still succeeds end-to-end: the original extension is preserved on disk, the memo is created with `type: "file"`, and the background processor no longer tries to UTF-8 read a binary blob (e.g. `.blend`, `.3mf`, archives) — `content_text` stays empty for true binaries instead of being polluted with replacement characters. Known-text extensions (`.txt`, `.csv`, `.log`, `.tsv`, `.srt`, `.vtt`) still get read.
- 🌐 **Local copies of extracted web content** — saved articles/links now download their referenced images into `files/extracted/<memo_id>/` and rewrite the Markdown to a local `/api/files/extracted/...` route, so memos survive the source being deleted. Runs automatically on new URL/extension ingests; a Settings → Uploads "Localize" button backfills existing memos. Served with a path-traversal-guarded route registered before the catch-all.

### Changed

- 🧹 **Phase out Tailwind** — documented in `CLAUDE.md`: Tailwind's `dark:` variant is incompatible with the `[data-theme]` theme system; components using Tailwind classes should be migrated to the `om-*` token system on sight.
- 🛠️ **Local dev one-command startup** — `dev.ps1` starts uvicorn on `:8099` in its own terminal then launches `npm run dev` with the proxy pointed at it; no Docker required for raw dev. `DATABASE_URL` and `CHROMA_PERSIST_DIR` are now absolute paths anchored to the project root so the wrong DB is never created regardless of which directory uvicorn starts from. Vite proxy target is configurable via `VITE_API_TARGET` env var (now defaults to `:8099` for local dev; Docker users can override to `:8091`).

---
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

- 💾 **Backup & Restore** — `POST /api/backup?scope=structure` downloads a hot SQLite snapshot (memos, collections, tags, chats, memocasts) as a zip; `scope=full` also bundles all uploaded files (thumbnail cache excluded). `POST /api/backup/restore` accepts the zip, disposes the SQLAlchemy pool atomically, replaces the database, and restores files for full-scope backups. Settings page gains a **Backup & Restore** card with Download buttons for each scope and a double-confirmed Restore flow.

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
- 🗑️ **MemoCast surface removal** — continued cleanup of MemoCast-facing navigation and routing in the active UI flow while preserving archived code where needed.
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
- 🗑️ **MemoCast removed** — Removed from sidebar nav and frontend routing. Backend memocast router disabled. Code preserved at `frontend/src/pages/_archived/MemoCastPage.tsx` and `backend/core/_archived/tts.py`.
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
- 📐 `MemoCastPage`, `AskMemoPage`: `rounded-2xl overflow-hidden` containers
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
- **MemoCast audio playback** — Play/pause now wires to a real `<audio>` element with progress tracking and time display
- **Dedicated Docker port** — Default access URL changed from `localhost:80` to `localhost:8091`. No hosts file or port conflicts needed
- **Removed dead UI** — Hidden Voice tab, Share/Tag/More buttons in MemoDetail until implemented

---

## [1.6.5] - 2026-05-05

### Sidebar & Navigation

- **Push sidebar layout** — Sidebar is now a true flex push layout (`width: 0 ↔ 240px`) instead of an absolute overlay. Main content shrinks naturally when sidebar opens. Removed `backdrop-blur-sm` overlay entirely.
- **Global hamburger menu** — Moved the sidebar toggle from Dashboard to `Layout.tsx` so it's accessible on **all pages** (Dashboard, AskMemo, MemoCast, MemoDetail, Settings).

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
  - **Components updated:** Sidebar, Dashboard, MemoCard, MemoGrid, MemoDetail, AskMemoPage, AskMemoPanel, MemoCastPage, AddMemoModal, SearchModal, Layout.

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
