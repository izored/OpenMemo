# Plan 016: A single-memo mutation no longer refetches every memo list in the app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/src/hooks/useMemoMutations.ts frontend/src/components frontend/src/pages`
> If the files changed since this plan was written, compare the "Current
> state" against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/015-extract-memo-mutation-hooks.md` (must land first)
- **Category**: tech-debt
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

~22 call sites invalidate the entire `['memos']` query on any single-memo change.
One pin or delete refetches every memo list in the app at once (dashboard, music
library, hidden section, every open collection). On a large library that is a
refetch storm. After `plans/015` funnels mutations through one hook, this plan
narrows what gets invalidated to just the affected lists, in that one place.

## Current state

> This plan assumes `plans/015` has landed, so the invalidation logic lives in
> `frontend/src/hooks/useMemoMutations.ts` in an `invalidate()` helper that today
> fires:
> ```tsx
> queryClient.invalidateQueries({ queryKey: ['memos'] });
> queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
> ```

To narrow safely you must first know the **shape of the query keys** the list
endpoints use. Read the query-key construction in the list consumers:
- `frontend/src/pages/Dashboard.tsx`, `MusicPage.tsx`, `CollectionsPage.tsx`,
  `HiddenPage.tsx` — find each `useQuery({ queryKey: [...] })` for memo lists and
  record the exact key arrays (e.g. `['memos', { type, collectionId, hidden }]` or
  `['memos', type, collectionId]` — discover the real shape; do not assume).

TanStack Query's `invalidateQueries({ queryKey: ['memos'] })` already does a
**prefix match** — it invalidates every query whose key starts with `'memos'`.
That is exactly the over-broad behavior. Narrowing means invalidating with a more
specific prefix or a `predicate`, only for the lists a given mutation can affect.

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Find memo query keys | `grep -rn "queryKey: \['memos'" frontend/src` | enumerates sites |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |

(Run greps from repo root or `frontend/`; paths above assume root.)

## Scope

**In scope**:
- `frontend/src/hooks/useMemoMutations.ts` (the `invalidate` helper)
- The list-query consumers ONLY if their query keys need normalizing to make
  targeted invalidation possible: `Dashboard.tsx`, `MusicPage.tsx`,
  `CollectionsPage.tsx`, `HiddenPage.tsx`

**Out of scope**:
- Re-introducing inline mutations (they were centralized in `plans/015` — keep them
  centralized).
- Chat/session query keys (`['chat-sessions']`, `['memo', id]`) — leave as-is.
- Any backend change.

## Git workflow

- Branch: `advisor/016-targeted-query-invalidation`
- One commit, conventional style:
  `perf(memo): scope query invalidation so one mutation doesn't refetch every list`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Map the actual memo-list query keys

Run `grep -rn "queryKey: \['memos'" frontend/src` and read each hit. Write down,
for each list, its exact key array and the filters it encodes. Decide the minimal
set of keys that a pin/delete/hide actually affects. In practice a delete or hide
can affect any visible list, so the realistic narrowing is:
- keep a single `invalidateQueries({ queryKey: ['memos'] })` for **delete** (it can
  remove a row from any list), BUT
- for **pin** and **hidden toggles**, invalidate only the lists whose ordering or
  membership those flags change.

If the keys are currently inconsistent (some `['memos', type]`, some `['memos', {…}]`),
normalizing them to one documented shape is the enabling step. Only normalize if
needed — minimal diff wins.

**Verify**: you have a written key map; no code changed yet.

### Step 2: Narrow the hook's invalidation

In `useMemoMutations.ts`, replace the single broad `invalidate()` with intent-specific
helpers, using a `predicate` to target only relevant lists. Example using a
predicate (adjust to the real key shape from Step 1):

```tsx
const invalidateLists = (opts?: { onlyPinned?: boolean }) => {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (key[0] !== 'memos') return false;
      if (opts?.onlyPinned) return key.includes('pinned');
      return true;   // delete/hide can touch any list
    },
  });
};

const togglePin = async (id: string, pinned: boolean) => {
  try { await memoApi.update(id, { pinned }); invalidateLists({ onlyPinned: false }); }
  catch { showNotice(...); }
};
```

The concrete win: pin no longer blows away unrelated detail/chat caches, and the
predicate is the single lever for future tuning. If Step 1 shows the keys already
encode enough specificity to invalidate by exact key instead of a catch-all
predicate, prefer exact keys.

**Verify**: `npm run build` (from `frontend/`) → exit 0. Behavior preserved: pin,
delete, hide all still update the visible lists (Step 4 manual smoke).

### Step 3: Normalize list query keys if required

Only if Step 1 found inconsistent key shapes that prevent clean targeting: update
the `useQuery` keys in the four list pages to a single documented shape (e.g.
`['memos', { type, collectionId, hidden, audioKind }]`) and adjust the hook's
predicate to match. Keep the change mechanical and consistent across all four.

**Verify**: `grep -rn "queryKey: \['memos'" frontend/src` → keys follow one shape.
`npm run build` → exit 0.

### Step 4: Full checks + manual smoke

**Verify** (from `frontend/`): `npm run lint` → 0; `npm run build` → 0; `npm test` → all pass.

Manual smoke (the behavior must not regress): pin a card on the dashboard → it
moves/updates; delete a card → it disappears from the list; toggle hidden → it
leaves the dashboard and appears in the hidden section. None of these should stop
working.

## Test plan

- If `plans/018` has landed, extend `useMemoMutations.test.ts` to assert the
  predicate is invoked and that a pin mutation does NOT invalidate a `['memo', id]`
  or `['chat-sessions']` query (spy on `invalidateQueries` / use a real
  `QueryClient` and inspect query states).
- Otherwise rely on build/lint/test-clean + the manual smoke. Do not build a
  harness here.

## Done criteria

ALL must hold:

- [ ] Mutations still flow through `useMemoMutations` (no re-inlined invalidations)
- [ ] The hook uses a targeted predicate/exact keys, not a blanket `['memos']` for every action
- [ ] Pin/delete/hide all still update the visible lists (manual smoke passed)
- [ ] `['memo', id]` and `['chat-sessions']` caches are not invalidated by a pin
- [ ] `npm run lint` / `npm run build` / `npm test` pass
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- `plans/015` has NOT landed (this plan depends on the centralized hook) — STOP and
  report; do not re-inline mutations to do this.
- The query keys are too entangled to narrow without touching many components
  beyond the four listed — report the scope creep.
- Narrowing causes a list to stop updating after a mutation (caught in the manual
  smoke) and the fix isn't a small predicate tweak — revert and report.

## Maintenance notes

- The predicate in the hook is now the single place to tune invalidation. Document
  the canonical memo-list query-key shape in a comment there so new lists conform.
- Reviewer should focus on the manual-smoke matrix (pin/delete/hide × dashboard/
  collection/music/hidden) — correctness of invalidation is behavioral, not typed.
- If virtualization or infinite scroll changes the list query keys later, revisit
  the predicate.
