# 023 — Give toasts an exit animation (stop the hard vanish)

- **Status**: TODO
- **Commit**: bf529e5
- **Severity**: MEDIUM
- **Category**: Interruptibility / Missed opportunity
- **Estimated scope**: 3 files, ~40 lines

## Problem

Both toasts animate IN with a keyframe but unmount instantly — after the 5s undo window (or clicking Undo/✕) they teleport away, a jarring change on an element the user is actively watching:

```css
/* frontend/src/styles/openmemo.css:1477 (delete toast) and :1497 (notice toast) — current */
animation: om-toast-in .2s cubic-bezier(.2,.7,.2,1);
```

```tsx
/* frontend/src/components/DeleteToast.tsx:57 — current: conditional unmount, no exit */
if (!toast) return null;
```

```tsx
/* frontend/src/components/NoticeToast.tsx:21 — current */
if (!notice) return null;
```

## Target

A `closing` class drives a 160ms exit (down + fade, ease-out); unmount happens after it finishes. Entrance keyframe stays.

```css
/* target — add to frontend/src/styles/openmemo.css after @keyframes om-toast-in (line ~1480) */
.om-delete-toast.closing,
.om-notice-toast.closing {
  animation: om-toast-out 160ms var(--ease-out) forwards;
}
@keyframes om-toast-out { to { opacity: 0; transform: translateX(-50%) translateY(8px); } }
```

```tsx
/* target — shared pattern in both components: */
const [closing, setClosing] = useState(false);
const dismiss = () => setClosing(true);                    // instead of clearing store directly
// on the toast root:
//   className={cn('om-delete-toast', closing && 'closing')}
//   onAnimationEnd={(e) => { if (closing && e.animationName === 'om-toast-out') { setClosing(false); clearDeleteToast(); } }}
```

DeleteToast specifics: the auto-timeout at `DeleteToast.tsx:27-33` and `handleUndo` (`:42-55`) both call `clearDeleteToast()` — route both through `dismiss()`; the store clear moves to `onAnimationEnd`. `handleUndo` still runs the restore API immediately (do not delay the API call). Reset `closing` to `false` when a new `toast` arrives (top of the `useEffect` keyed on `toast?.memoId`).

NoticeToast specifics: the timeout at `NoticeToast.tsx:17` and the ✕ button's `onClick={clearNotice}` both become `dismiss()`; `clearNotice()` moves to `onAnimationEnd`. Reset `closing` when `notice` changes.

## Repo conventions to follow

- Easing token: `--ease-out` from `frontend/src/styles/transitions.css`.
- Both toasts intentionally share geometry and motion (comment at `NoticeToast.tsx:8-10`) — keep exit identical for both.

## Steps

1. Add the `closing` CSS + `om-toast-out` keyframes to `frontend/src/styles/openmemo.css` (after line ~1480).
2. Rework `DeleteToast.tsx` per Target: `closing` state, `dismiss()`, `onAnimationEnd` unmount, reset on new toast.
3. Rework `NoticeToast.tsx` the same way.
4. Guard rapid re-trigger: if a new delete happens while the old toast is closing, the new toast must render fresh (entrance animation restarts because the element remounts via the store's new toast object).

## Boundaries

- Do NOT switch toasts to framer-motion / AnimatePresence — plain CSS is the house style here.
- Do NOT change toast copy, timing constants (5000/4000ms), or the progress-bar logic.
- Do NOT delay the restore API call on Undo.
- If code differs from the excerpts, STOP and report.

## Verification

- **Mechanical**: `cd frontend && npx tsc -b && npm run lint` — no new errors.
- **Feel check**:
  - Delete a memo, wait 5s: toast slips down and fades, no teleport.
  - Delete a memo, click Undo: memo returns AND toast exits softly.
  - Trigger a notice (e.g. an error), click ✕: same exit.
  - Delete two memos back-to-back quickly: second toast appears cleanly, no stuck `closing` state.
  - Reduced motion emulated: exit still only 160ms fade/slide (acceptable), no long movement.
- **Done when**: no toast ever disappears in a single frame.
