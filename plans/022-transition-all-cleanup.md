# 022 — Replace `transition: all` with explicit properties on interactive elements

- **Status**: TODO
- **Commit**: bf529e5
- **Severity**: MEDIUM
- **Category**: Performance / Easing & duration
- **Estimated scope**: 3 files, ~6 lines

## Problem

`transition: all` animates every mutating property — including layout properties and colors you never intended — off the compositor. Three interactive, frequently-hovered surfaces use it:

```tsx
/* frontend/src/components/Card.tsx:31 — current (hover lift on dashboard cards) */
interactive && 'cursor-pointer transition-all duration-[var(--duration-base)] ease-out hover:-translate-y-1',
```

Also, 280ms (`--duration-base`) is too slow for a hover response; hovers belong at ~150ms.

```css
/* frontend/src/styles/openmemo.css:1851 — current (.om-tab-btn, video content tabs) */
border: 1px solid transparent; transition: all var(--transition-fast); }
```

```tsx
/* frontend/src/components/MarkdownEditor.tsx:276 — current (editor container ring) */
'relative rounded-2xl transition-all om-md-editor',
```

## Target

```tsx
/* target — Card.tsx:31: transform + shadow only, fast hover */
interactive && 'cursor-pointer transition-[transform,box-shadow] duration-[var(--duration-fast)] ease-out hover:-translate-y-1',
```

```css
/* target — openmemo.css .om-tab-btn: it changes color/background/border-color only */
border: 1px solid transparent;
transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast); }
```

```tsx
/* target — MarkdownEditor.tsx:276: the container animates its focus ring (box-shadow/border) */
'relative rounded-2xl transition-[box-shadow,border-color] om-md-editor',
```

## Repo conventions to follow

- Duration/easing tokens: `frontend/src/styles/transitions.css` (`--transition-fast` = `150ms cubic-bezier(0.16,1,0.3,1)`, `--duration-fast` = `150ms`).
- Exemplar of explicit-property transition: `frontend/src/styles/openmemo.css:2100` (`.om-ask-panel-send` transitions `opacity` and `background` explicitly).

## Steps

1. `frontend/src/components/Card.tsx:31`: replace `transition-all duration-[var(--duration-base)]` with `transition-[transform,box-shadow] duration-[var(--duration-fast)]`.
2. `frontend/src/styles/openmemo.css:1851` (`.om-tab-btn`): replace `transition: all var(--transition-fast);` with `transition: color var(--transition-fast), background var(--transition-fast), border-color var(--transition-fast);`.
3. `frontend/src/components/MarkdownEditor.tsx:276`: replace `transition-all` with `transition-[box-shadow,border-color]`.
4. Verify no visual property silently stops transitioning: check each element's hover/focus styles and add any transitioned property to the explicit list.

## Boundaries

- Do NOT touch `.om-coach-spot` (`openmemo.css:5333`) — onboarding spotlight deliberately tweens layout box via `all`; rare-frequency, acceptable.
- Do NOT change hover translate distance, colors, or markup.
- If a line differs from the excerpt, STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc -b && npm run lint` — no new errors.
- **Feel check**:
  - Dashboard cards still lift on hover, now snappier (~150ms).
  - Video description/transcript tabs still tint on hover; active tab border still appears.
  - Markdown editor focus ring still fades in on focus.
- **Done when**: the three sites list explicit properties and all hover/focus states still animate.
