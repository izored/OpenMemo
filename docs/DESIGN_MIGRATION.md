# Design Migration — Claude Design bundle → OpenMemo frontend

Source: handoff bundle `OpenMemo.html` (Claude Design). HTML/CSS/JS prototype
recreated in the real React 19 + TS + Vite + Tailwind v4 app, wired to the
live FastAPI backend (no mock data).

Branch: `claude/competent-beaver-1a00f1`.

---

## How the bundle was processed

- Artifact URL returned a 13 MB gzip stream → `gzip -d` → `tar` archive.
- Extracted: `README.md`, 6 chat transcripts, `project/*.jsx`, `styles.css`,
  `OpenMemo.html`, screenshots, uploads.
- Read every source file top-to-bottom + chats for intent.

---

## Imported (done)

### Design system
- `styles.css` (1635 lines) copied **verbatim** → `frontend/src/styles/openmemo.css`,
  imported last in `main.tsx` so it owns layout. Token-driven: every surface /
  shadow / radius is a CSS var keyed off `data-theme` / `data-card` /
  `data-density` / `data-layout` / `data-bg` on `<html>`.
- Fontshare fonts (Satoshi / General Sans / Cabinet Grotesk) added to `index.html`.
- Icon set ported 1:1 → `frontend/src/components/Icon.tsx`.
- Appearance math (`shade`, `accentHarmony`, `randomBlobPositions`, theme/accent/
  background var application) → `frontend/src/lib/appearance.ts`.

### State
- `appStore` extended with persisted `tweaks` (theme, accent, cardStyle,
  layout, gridColumns, background mode/image/palette/positions, custom accents)
  + panel/search/sidebar-collapse flags. Applied to `<html>` live via effect.

### Screens / components (wired to real API)
- **Layout** — `.om-app` grid shell, sidebar collapse, FAB, all panels.
- **Sidebar** — `.om-sidebar`: nav, pinned/collections from API, collapse,
  footer → settings, search trigger. dnd droppable kept.
- **MemoCard** — Note / Link / Image / Video / Document variants mapped to real
  `Memo` fields, real thumbnails, hashed tint fallback, drag handle + delete.
- **MemoGrid** — masonry + dnd reorder + collection-drop + framer-motion FLIP
  kept. Viewport-clamped column count. Boxed/full width.
- **Dashboard** — greeting eyebrow + filter rail + sort affordance.
- **AddMemoPanel** — FAB glass panel, animated-height tab morph (the sleek
  expand requested), wired to `ingestApi` (link / note / file).
- **AppearancePanel** — live tweaks (theme, accent + custom swatches, card
  style, layout, grid columns, background image/random).
- **FullscreenWriter** — wired to note ingest.
- **SearchOverlay** — ⌘K, real `searchApi`.
- **AskMemoPage** — `.om-ask` chat thread, streaming + model select kept.
- **SettingsPage** — `.om-settings` grid; real stats / ollama / version;
  Appearance CTA navigates home then animates the panel in.

### Deliberate deviations (per user)
- **Memo detail stays a routed page** (`/memo/:id`) — the design's slide-over
  `.om-detail` + backdrop blur was explicitly rejected. `MemoDetail.tsx` left
  functional as-is.
- **Density control removed**; locked to `roomy`.
- **Layout width toggle added** (Boxed default / Full) — not in original design.
- **Sparse-grid guard** added (`.om-masonry-col` max-width + left-align) so a
  lone card doesn't balloon full-width — original prototype never hit this
  because it used fixed mock data.

---

## Not imported

- ~~**Collections page**~~ — **now implemented** (v1.8), see Post-migration
  additions below.
- **Logo showcase** (`LogoShowcase`, 3 logo proposals) — design-exploration
  artifact, not product UI.
- **Tweaks dev panel** (`tweaks-panel.jsx` / `TweaksPanel`) — prototype-only
  live-edit harness; superseded by the real Appearance panel + persisted store.
- **Mock data** (`data.jsx`: MOCK memos, gradients, photo placeholders, note
  tints, collection covers) — replaced by live API data.
- **Detail-page rich sections** — "Highlights", hard-coded "AI summary" prose,
  "Connected memos" decorative list from the slide-over were not ported (the
  real `MemoDetail` already has its own AI summary / related / notes wired to
  the backend).
- **Add-panel niceties** — link URL live preview card, "recent files" list,
  voice recording (UI shown, disabled — no backend).
- **Tags on capture** — Add panel collects tags in UI but ingest endpoints
  (`/ingest/url`, `/ingest/note`) take only `collection_id`; tags not sent.

---

## Difficult / deferred

- **Dominant-color card tinting** — **addressed in v1.8** via a pragmatic
  no-backend approach: a blurred, saturated, scaled copy of the card's own
  preview image is rendered behind the surface at ~32% opacity with an accent
  wash. Cards pick up the resource's real colors without server-side palette
  extraction or canvas/CORS sampling. True per-memo dominant hex (stored on
  ingest) is still the "proper" long-term fix but no longer blocking.
- **`color-mix(in oklab, …)`** — used heavily by the design tokens for accent
  tinting. Fine in modern Chromium/Safari; degrades on old browsers. Acceptable
  for a local-first desktop-class app, flagged for awareness.
- **MemoDetail theming split** — detail page still uses the legacy
  `--color-*` Tailwind vars from `index.css` (light works; dark follows the old
  `.dark` class, not the new `data-theme="hi"`). Unifying it onto the new token
  system is a full restyle of a large, functional file — deferred to keep the
  app stable.
- **Two coexisting CSS systems** — `index.css` (Tailwind v4 + `--color-*`) and
  `openmemo.css` (`--bg/--text/--accent`). No name collisions; om-prefixed
  classes are isolated. Long-term, retiring `index.css` once every screen is on
  the new system would remove the duplication.
- **Voice capture** — design shows a waveform + record UI; no transcription
  backend (`Whisper · local` was aspirational). Left as disabled placeholder.
- **Background image perf** — `bgImage` stored as a data URL in localStorage.
  v1.8 mitigates: 5 MB hard upload ceiling + canvas downscale to ≤1280px /
  JPEG q0.72 before persisting. A backend/object-store impl is still cleaner
  long-term but no longer a practical problem.

---

## Post-migration additions & fixes (v1.8)

Built after the initial recreation, on the same branch:

### Added
- **Collections page** (`/collections`) — design's stacked-card fan-out, wired
  to `collectionApi` + per-collection memo count/recent via `useQueries`.
  Cover = collection `thumbnail_path` if backend provides one, else latest
  memo's thumbnail, else color gradient. Hover **edit** button opens the
  collection modal. "New collection" card.
- **Sliding filter pill** — framer-motion shared-layout pill under the active
  dashboard filter.
- **Dominant-color card backdrop** — blurred preview behind the surface.
- **Background fade slider** (`bgFade`) — a `var(--bg)` veil above the gradient
  orbs; dial the backdrop toward the base color without recomputing gradients.
- **Boxed / Full layout toggle** (`layout` tweak) — caps the grid width.
- **Real storage stats** — backend `/api/stats` now returns
  `storage{db,files,cache,total bytes}`; Settings "Storage" card with bar.
- **Browser-extension Settings card** — install/GitHub link to
  `chrome-extension/`.
- **Sort dropdown** — Recent (default) / Oldest / Title / Custom; client-side.
- **New-memo collection flyout** — left-side second panel replacing the cropped
  in-panel popup, with a "New collection…" action.

### Changed / Fixed
- Density control **removed**; locked to `roomy`.
- Settings: Identity → **Creator** card (no avatar, `dev.izo.red`), Danger zone
  reflowed 3/4 + Creator 1/4 so it no longer over-pads.
- Settings → Appearance navigates **home then animates** the panel in.
- Sparse-grid guard: `.om-masonry-col` max-width capped (300 / 320 roomy) so a
  lone card no longer balloons full-width.
- Menu/option **text stays the text color**; accent reserved for icons /
  indicators only (collection + sort menus).

### Still backend-blocked
- **User-uploaded collection thumbnail** — frontend reads
  `collection.thumbnail_path` if present, but there's no DB column / upload
  endpoint yet. Latest-memo cover works in the meantime.
