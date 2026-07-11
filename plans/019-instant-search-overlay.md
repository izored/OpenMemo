# 019 — Make Ctrl+K search overlay open instantly

- **Status**: TODO
- **Commit**: bf529e5
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 2 files, ~10 lines

## Problem

The search overlay is a command-palette-style surface opened by a keyboard shortcut dozens of times per day (`frontend/src/components/Layout.tsx:208` binds Ctrl/Cmd+K). Keyboard-initiated, high-frequency actions must not animate — the animation delays the exact moment the user wants to type (Raycast's palette has zero open/close animation for this reason).

Today the overlay inherits a 200ms pop from the shared modal class and a 200ms backdrop fade:

```css
/* frontend/src/styles/openmemo.css:2109 — current (.om-modal, shared by all modals) */
.om-modal {
  /* … */
  animation: pop .2s cubic-bezier(.2,.7,.2,1);
}
@keyframes pop { from { transform: translate(-50%, -48%) scale(0.96); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
```

```css
/* frontend/src/styles/openmemo.css:1441 — current */
.om-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(6px);
  animation: fade .2s ease;
}
```

The SearchOverlay renders both (`frontend/src/components/SearchOverlay.tsx:63-65`):

```tsx
<div className="om-backdrop" onClick={() => setOpen(false)} />
<div className="om-modal" role="dialog" aria-label="Search Memos">
```

There is also a 30ms focus delay at `frontend/src/components/SearchOverlay.tsx:22`:

```tsx
setTimeout(() => inputRef.current?.focus(), 30);
```

## Target

The search overlay (and only the search overlay — mouse-opened modals keep their pop) opens with no entrance animation. Focus lands in the input on the same frame.

```css
/* target — add to frontend/src/styles/openmemo.css next to .om-modal rules */
/* Keyboard-opened palette: no entrance animation (frequency rule) */
.om-modal.om-modal-instant,
.om-backdrop.om-backdrop-instant { animation: none; }
```

```tsx
// target — frontend/src/components/SearchOverlay.tsx
<div className="om-backdrop om-backdrop-instant" onClick={() => setOpen(false)} />
<div className="om-modal om-modal-instant" role="dialog" aria-label="Search Memos">
```

Keep the 30ms focus timeout (it exists so focus lands after mount; it is not animation-related) — but it may be reduced to 0ms via `requestAnimationFrame` if focus still lands reliably.

## Repo conventions to follow

- Utility-variant classes on `om-*` blocks are the house pattern (e.g. `.om-notice-toast.error` at `frontend/src/styles/openmemo.css:1500`).
- CSS lives in `frontend/src/styles/openmemo.css`, grouped by component with `/* ─ Section ─ */` headers.

## Steps

1. In `frontend/src/styles/openmemo.css`, directly after the `@keyframes pop` rule (line ~2122), add the `.om-modal.om-modal-instant, .om-backdrop.om-backdrop-instant { animation: none; }` rule with the comment shown in Target.
2. In `frontend/src/components/SearchOverlay.tsx`, add `om-backdrop-instant` to the backdrop div's className and `om-modal-instant` to the modal div's className.

## Boundaries

- Do NOT touch any other modal (AddMemoModal, AddCollectionModal, etc.) — they open by mouse and keep the pop.
- Do NOT remove the `pop`/`fade` keyframes.
- Do NOT change SearchOverlay markup or logic beyond the two className strings.
- If the code differs from the excerpts above (drift since bf529e5), STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc -b && npm run lint` — no new errors.
- **Feel check**: run the app, press Ctrl+K repeatedly:
  - Overlay appears fully-formed on the next frame; no scale/fade-in.
  - Backdrop blur is present immediately.
  - Opening the Add Memo modal by mouse still pops (unchanged).
- **Done when**: Ctrl+K shows the search input with zero perceptible entrance motion and typing is possible immediately.
