# 020 — SpeedDialFAB: replace ease-in entrances with strong ease-out

- **Status**: TODO
- **Commit**: bf529e5
- **Severity**: HIGH
- **Category**: Easing & duration / Physicality
- **Estimated scope**: 1 file, ~6 lines

## Problem

The floating "+" speed-dial animates its fan-out items and its plus-icon rotation with `ease-in` — the curve that starts slow and accelerates. Entrances must start fast (`ease-out`); `ease-in` on UI is always wrong because it delays the moment the user is watching. The items also start at `scale(0.6)`, far below the 0.9–0.97 range that reads as physical.

```tsx
/* frontend/src/components/SpeedDialFAB.tsx:60-64 — current */
transform: isOpen
  ? `translate(-50%, calc(-50% + ${item.ty})) scale(1)`
  : 'translate(-50%, -50%) scale(0.6)',
opacity: isOpen ? 1 : 0,
transition: `transform 220ms ease-in ${delay}ms, opacity 180ms ease-in ${delay}ms`,
```

```tsx
/* frontend/src/components/SpeedDialFAB.tsx:124-125 — current */
transform: isOpen ? 'rotate(-45deg)' : 'rotate(0deg)',
transition: 'transform 200ms ease-in',
```

## Target

Use the repo's existing strong ease-out token and a physical starting scale. Keep the 40ms stagger (`delay`) — it is correct.

```tsx
/* target — item wrapper style */
transform: isOpen
  ? `translate(-50%, calc(-50% + ${item.ty})) scale(1)`
  : 'translate(-50%, -50%) scale(0.92)',
opacity: isOpen ? 1 : 0,
transition: `transform 220ms var(--ease-out) ${delay}ms, opacity 180ms var(--ease-out) ${delay}ms`,
```

```tsx
/* target — plus icon */
transform: isOpen ? 'rotate(-45deg)' : 'rotate(0deg)',
transition: 'transform 200ms var(--ease-out)',
```

## Repo conventions to follow

- Easing tokens live in `frontend/src/styles/transitions.css`: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (already a strong ease-out — use the token, do not hand-type a bezier).
- Inline `style` transitions are already the pattern in this component; keep them inline.

## Steps

1. In `frontend/src/components/SpeedDialFAB.tsx` line 62, change `scale(0.6)` to `scale(0.92)`.
2. Line 64: replace both `ease-in` occurrences with `var(--ease-out)`.
3. Line 125: replace `ease-in` with `var(--ease-out)`.

## Boundaries

- Do NOT change durations, the stagger math, hover-label logic, or FAB layout constants.
- Do NOT touch any other component.
- If the code differs from the excerpts above, STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc -b && npm run lint` — no new errors.
- **Feel check**: hover the "+" FAB (bottom-right on dashboard):
  - Items now spring out immediately and decelerate into place (fast start, soft landing).
  - Closed state: items shrink subtly, not to a dot. In DevTools Animations panel at 10% speed, the first frames of opening show visible movement (ease-out), not a stall.
  - The plus rotates to × with the same fast-start feel.
- **Done when**: no `ease-in` remains in SpeedDialFAB.tsx and the fan-out reads responsive at full speed.
