# Plan 011: Note autosave stops overwriting in-progress typing after a server refetch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/src/pages/MemoDetail.tsx`
> If `MemoDetail.tsx` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

The memo notes field auto-saves on a 1s debounce. On save it invalidates the
`['memo', id]` query, which refetches; when fresh `memo` data arrives, an effect
unconditionally resets the local `notesDraft` to the server value. If the user kept
typing during the save+refetch window, their in-flight keystrokes are overwritten
by the server echo, silently losing edits. The fix: only adopt the server value
when the local draft is not dirty.

## Current state

`frontend/src/pages/MemoDetail.tsx:1022-1048`:

```tsx
// Debounced notes auto-save when not in edit mode
const [notesDraft, setNotesDraft] = useState('');
const [notesSaving, setNotesSaving] = useState(false);

useEffect(() => {
  if (memo?.notes !== undefined) setNotesDraft(memo.notes || ''); // eslint-disable-line react-hooks/set-state-in-effect
}, [memo?.notes]);

const saveNotes = useCallback(async () => {
  if (!id || isEditing) return;
  if (notesDraft === (memo?.notes || '')) return;
  setNotesSaving(true);
  try {
    await memoApi.update(id, { notes: notesDraft });
    queryClient.invalidateQueries({ queryKey: ['memo', id] });   // ← triggers refetch
  } catch (e) {
    console.error(e);
  } finally {
    setNotesSaving(false);
  }
}, [id, notesDraft, memo?.notes, isEditing, queryClient]);

useEffect(() => {
  const timer = setTimeout(saveNotes, 1000);
  return () => clearTimeout(timer);
}, [notesDraft, saveNotes]);
```

The hazard is the first effect: it runs whenever `memo?.notes` changes (including
the post-save refetch) and blindly calls `setNotesDraft(memo.notes)`, discarding
any newer keystrokes.

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Typecheck+build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `frontend/src/pages/MemoDetail.tsx` (only the notes-autosave block, lines ~1022–1048)

**Out of scope**:
- The rest of MemoDetail (its size is addressed separately in `plans/017`).
- `memoApi.update` in `frontend/src/lib/api.ts`.
- The edit-mode form (this is the not-editing autosave path).

## Git workflow

- Branch: `advisor/011-fix-notes-autosave-clobber`
- One commit, conventional style:
  `fix(memo): don't let a notes refetch overwrite in-progress typing`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Track the last saved/known-server value and only adopt it when clean

Introduce a ref holding the value last synced from (or saved to) the server, and
only reset `notesDraft` from `memo.notes` when the draft equals that last-synced
value (i.e. the user has no unsaved local edits). Target shape:

```tsx
const [notesDraft, setNotesDraft] = useState('');
const [notesSaving, setNotesSaving] = useState(false);
const lastSyncedNotes = useRef<string>('');

// Adopt server notes only when the local draft has no unsaved edits.
useEffect(() => {
  const server = memo?.notes || '';
  if (notesDraft === lastSyncedNotes.current) {
    setNotesDraft(server);            // eslint-disable-line react-hooks/set-state-in-effect
  }
  lastSyncedNotes.current = server;
}, [memo?.notes]);                    // keep deps as-is; notesDraft read is intentional snapshot
```

Important: this effect must keep `[memo?.notes]` as its dependency (adding
`notesDraft` would make it re-run on every keystroke and re-introduce churn). The
`notesDraft === lastSyncedNotes.current` read inside is an intentional snapshot
comparison; keep the existing eslint-disable comment if the linter complains.

After a successful save, update the ref so the subsequent refetch is recognized as
"clean":

```tsx
const saveNotes = useCallback(async () => {
  if (!id || isEditing) return;
  if (notesDraft === (memo?.notes || '')) return;
  setNotesSaving(true);
  try {
    await memoApi.update(id, { notes: notesDraft });
    lastSyncedNotes.current = notesDraft;   // we just persisted this exact value
    queryClient.invalidateQueries({ queryKey: ['memo', id] });
  } catch (e) {
    console.error(e);
  } finally {
    setNotesSaving(false);
  }
}, [id, notesDraft, memo?.notes, isEditing, queryClient]);
```

Ensure `useRef` is imported in the file (it almost certainly already is — grep).

**Verify**: `grep -n "lastSyncedNotes" frontend/src/pages/MemoDetail.tsx` → shows
the ref declared, set in `saveNotes`, and compared in the adopt-effect.
`npm run build` (from `frontend/`) → exit 0.

### Step 2: Full frontend checks

**Verify** (from `frontend/`): `npm run lint` → 0; `npm run build` → 0; `npm test` → all pass.

## Test plan

- No unit harness for pages exists yet (`plans/018`). Verification here is
  build/lint/test clean plus the manual reproduction below.
- If `plans/018` has landed, add a test: render `MemoDetail` with a mocked memo,
  type into notes, resolve the save, push a refetched memo with the *old* notes,
  and assert the typed value is preserved (not clobbered). Otherwise skip.

## Done criteria

ALL must hold:

- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm test` passes
- [ ] A `lastSyncedNotes` ref gates the adopt-from-server effect; the effect dep stays `[memo?.notes]`
- [ ] `saveNotes` updates `lastSyncedNotes.current` after a successful update
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The notes-autosave block no longer matches the excerpt.
- Removing the clobber requires restructuring the edit-mode form (out of scope).
- The eslint `react-hooks` rules reject the snapshot read in a way that can't be
  satisfied with the existing disable comment — report the exact lint error.

## Maintenance notes

- Manual reproduction to confirm the fix: open a memo, type continuously in notes
  for ~3 seconds (past the 1s debounce so a save+refetch fires mid-typing); the
  text must not jump back. Before the fix it does.
- This does not add multi-tab conflict resolution (two tabs editing the same memo
  still last-write-wins). That is a larger feature; note it, don't build it here.
- Reviewer should verify the adopt-effect dependency was NOT changed to include
  `notesDraft` (that reintroduces the churn this fix removes).
