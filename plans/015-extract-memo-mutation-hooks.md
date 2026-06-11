# Plan 015: Pin / delete / hide memo actions live in one shared hook with consistent error handling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/src/components/MemoCard.tsx frontend/src/pages/MemoDetail.tsx frontend/src/components/DeleteToast.tsx frontend/src/lib/api.ts frontend/src/stores`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (enables 016)
- **Category**: tech-debt
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

Pin, delete, and hide each call `memoApi.*` then `queryClient.invalidateQueries`
in several components, copy-pasted with divergent error handling: some use
`alert()`, some `console.error`, some swallow silently. A change to the API or the
invalidation strategy means editing N places, and users get inconsistent feedback.
Extracting one `useMemoMutations` hook gives a single place for the call +
invalidation + error toast, and is the prerequisite for the targeted-invalidation
work in `plans/016`.

## Current state

Duplicated mutation logic (representative sites):

- `frontend/src/components/MemoCard.tsx`:
  ```tsx
  // ~405-411 confirmDelete
  await memoApi.delete(memo.id);
  queryClient.invalidateQueries({ queryKey: ['memos'] });
  queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
  // ~457-462 handlePin
  // memoApi.update(... pinned ...); then the same two invalidations
  ```
  (delete has no try/catch around the API call — a failed delete closes the
  overlay silently; see `plans` finding notes.)
- `frontend/src/pages/MemoDetail.tsx` — its own `togglePin` / `handleDelete`
  repeat the `memoApi.* → invalidateQueries(['memos'])` shape; save errors here use
  `alert()`.
- `frontend/src/components/DeleteToast.tsx` — restore path repeats the pattern.
- Error surface that already exists: the Zustand store exposes `showNotice`
  (used in `MemoCard.tsx` via `const showNotice = useAppStore((s) => s.showNotice);`)
  and `showDeleteToast`. **Use `showNotice` for errors** — do not introduce a new
  toast system.
- `frontend/src/lib/api.ts` exposes `memoApi.update`, `memoApi.delete`, etc. (the
  single source for fetch calls — keep all API access there).

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Typecheck+build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `frontend/src/hooks/useMemoMutations.ts` (create)
- `frontend/src/components/MemoCard.tsx` (use the hook)
- `frontend/src/pages/MemoDetail.tsx` (use the hook for pin/delete/restore only)
- `frontend/src/components/DeleteToast.tsx` (use the hook for restore)

**Out of scope**:
- `frontend/src/lib/api.ts` — keep using existing `memoApi` methods; do not change them.
- The notes-autosave logic in MemoDetail (`plans/011`).
- The broad `['memos']` invalidation *strategy* — this plan centralizes it
  unchanged; `plans/016` then narrows the keys in one place.
- Any visual/markup change to the components.

## Git workflow

- Branch: `advisor/015-extract-memo-mutation-hooks`
- Commit per logical unit (hook, then each consumer) or one cohesive commit.
  Conventional style: `refactor(memo): centralize pin/delete/hide mutations in useMemoMutations`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the hook

Create `frontend/src/hooks/useMemoMutations.ts`. It wraps the existing `memoApi`
calls + invalidation + error notice. Keep the SAME invalidation keys the code uses
today (`['memos']` and `['memos','pinned']`) so behavior is identical — narrowing
happens in `plans/016`. Target shape:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { memoApi } from '../lib/api';
import { useAppStore } from '../stores/appStore';   // confirm the exact path/name

export function useMemoMutations() {
  const queryClient = useQueryClient();
  const showNotice = useAppStore((s) => s.showNotice);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['memos'] });
    queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
  };

  const togglePin = async (id: string, pinned: boolean) => {
    try {
      await memoApi.update(id, { pinned });
      invalidate();
    } catch (e) {
      showNotice('Could not update pin. Try again.', 'error');   // match showNotice's signature
    }
  };

  const remove = async (id: string) => {
    try {
      await memoApi.delete(id);
      invalidate();
      return true;
    } catch (e) {
      showNotice('Could not delete the memo. Try again.', 'error');
      return false;
    }
  };

  const toggleHidden = async (id: string, hidden: boolean) => {
    try {
      await memoApi.update(id, { hidden });
      invalidate();
    } catch (e) {
      showNotice('Could not update visibility. Try again.', 'error');
    }
  };

  return { togglePin, remove, toggleHidden, invalidateMemos: invalidate };
}
```

**Before writing**, read `frontend/src/stores/appStore.ts` to confirm
`showNotice`'s exact name and argument shape (it may take `(message)` or
`(message, kind)` — match it; do not invent a second arg if it doesn't exist).
Also confirm `memoApi.update` accepts `{ pinned }` / `{ hidden }` partials.

**Verify**: `npm run build` (from `frontend/`) → exit 0.

### Step 2: Adopt in MemoCard

In `MemoCard.tsx`, replace the inline `memoApi.delete`/`memoApi.update` +
invalidation in `confirmDelete`, `handlePin` (and the hidden toggle if present)
with calls to the hook. For delete, use the returned boolean to decide whether to
close the confirm overlay (only close on success); on failure the `showNotice`
fires and the overlay stays so the user can retry — this also fixes the silent
delete-failure issue.

Keep `showDeleteToast`/undo behavior intact (the hook handles the API+invalidation;
the existing toast call stays where it is).

**Verify**: `grep -n "memoApi.delete\|memoApi.update" frontend/src/components/MemoCard.tsx`
→ no longer present (all routed through the hook). `npm run build` → exit 0.

### Step 3: Adopt in MemoDetail and DeleteToast

- `MemoDetail.tsx`: replace its `togglePin` / `handleDelete` / restore inline logic
  with the hook. Replace any `alert()` on these paths with the hook's `showNotice`
  error. Leave the notes-autosave block alone (out of scope).
- `DeleteToast.tsx`: route restore through the hook (or `invalidateMemos` if it
  calls a restore endpoint not covered by the hook — if restore needs its own
  method, add a `restore(id)` to the hook mirroring the others).

**Verify**: `grep -rn "alert(" frontend/src/pages/MemoDetail.tsx` → none on the
pin/delete paths. `npm run build` → exit 0.

### Step 4: Full frontend checks

**Verify** (from `frontend/`): `npm run lint` → 0; `npm run build` → 0; `npm test` → all pass.

## Test plan

- If `plans/018` (frontend test harness) has landed: add
  `frontend/src/hooks/useMemoMutations.test.ts` (or `.tsx` with `@testing-library/react`
  `renderHook`) mocking `memoApi` and the store, asserting (a) success invalidates
  the memo queries, (b) a rejected `memoApi.delete` calls `showNotice` and returns
  `false`.
- If `plans/018` has NOT landed, no harness exists for hooks; rely on
  build/lint/test-clean + the manual smoke in Maintenance notes. Do not build a
  harness here.

## Done criteria

ALL must hold:

- [ ] `frontend/src/hooks/useMemoMutations.ts` exists and is used by MemoCard, MemoDetail, DeleteToast
- [ ] `grep -rn "invalidateQueries({ queryKey: \['memos'\] })" frontend/src/components/MemoCard.tsx frontend/src/pages/MemoDetail.tsx` → no direct calls (all via the hook)
- [ ] No `alert(` remains on the pin/delete paths
- [ ] Delete failure keeps the confirm overlay open and shows a notice (no silent close)
- [ ] `npm run lint` / `npm run build` / `npm test` all pass
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `showNotice`'s signature can't be determined from `appStore.ts` — report it.
- A consumer's mutation does something extra (optimistic update, special toast)
  that the generic hook would drop — report; preserve the behavior rather than
  losing it.
- Routing restore through the hook would require a new `memoApi` method that
  doesn't exist — report (adding it is fine but flag the api.ts touch).

## Maintenance notes

- This deliberately keeps the broad `['memos']` invalidation. `plans/016` narrows
  it in ONE place (the hook's `invalidate`), which is the whole point of doing this
  first.
- Manual smoke: pin a card, delete a card with the backend stopped (force the
  error) and confirm a notice appears and the card stays.
- Reviewer should confirm every former inline mutation now goes through the hook,
  so `plans/016` only has one function to edit.
