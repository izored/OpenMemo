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

- **Collections page** (`CollectionsPage`, stacked-card hover fan-out) — app
  has no collections route; collections filter the dashboard via sidebar instead.
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

- **Dominant-color card tinting** — chats asked cards to take the dominant
  color of the gathered resource (image/video/link thumb). Backend exposes no
  palette/dominant-color field; would need server-side extraction (e.g. on
  ingest, store an accent hex per memo) or client-side canvas sampling of
  thumbnails (CORS + perf risk). Current impl: real thumbnail when present,
  else a hashed warm-tint gradient fallback.
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
- **Background image perf** — `bgImage` stored as a data URL in localStorage;
  large images bloat storage. Fine for now; a real impl would persist to the
  backend / object store.
