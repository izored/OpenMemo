# 021 — Honor prefers-reduced-motion in all Framer Motion components

- **Status**: TODO
- **Commit**: bf529e5
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~4 lines

## Problem

The CSS side of the app gates movement behind `@media (prefers-reduced-motion: reduce)` in ~15 places (e.g. `frontend/src/styles/openmemo.css:1583`). The Framer Motion side does not: of 14 components importing `framer-motion`, only `frontend/src/components/onboarding/IntroSequence.tsx:66` calls `useReducedMotion()`. Card entrances (`MemoCard.tsx:355-358`), grid layout animation (`MemoGrid.tsx:36`), the theme-toggle clip-path ripple (`Layout.tsx:281`), sidebar/player transitions — all move for users who asked for less motion.

```tsx
/* frontend/src/App.tsx:13-16 — current */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
```

## Target

Wrap the app once in `MotionConfig reducedMotion="user"`. Framer Motion then automatically disables transform/layout animations (keeping opacity) for every `motion.*` element when the OS asks for reduced motion — the exact "fewer and gentler, not zero" behavior.

```tsx
/* target — frontend/src/App.tsx */
import { MotionConfig } from 'framer-motion';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Routes>
          {/* …unchanged… */}
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  );
}
```

## Repo conventions to follow

- `IntroSequence.tsx:66` already branches on `useReducedMotion()` — MotionConfig composes with it; do not remove that code.
- App.tsx is the composition root; global providers belong there.

## Steps

1. In `frontend/src/App.tsx`, add `import { MotionConfig } from 'framer-motion';`.
2. Wrap the existing `<BrowserRouter>…</BrowserRouter>` in `<MotionConfig reducedMotion="user">…</MotionConfig>`.

## Boundaries

- Do NOT touch individual motion components.
- Do NOT change routes.
- Do NOT add `useReducedMotion` calls anywhere.
- If App.tsx differs from the excerpt, STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc -b && npm run lint` — no new errors.
- **Feel check**: DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce":
  - Memo cards appear without the scale/slide entrance but still fade.
  - Theme toggle switches without the circular ripple.
  - With emulation off, everything animates as before.
- **Done when**: with reduced motion emulated, no transform-based movement remains in framer-driven UI while opacity feedback survives.
