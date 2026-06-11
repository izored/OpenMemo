# Plan 017: MemoDetail is split into focused sub-components instead of one 1,577-line file

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d847160..HEAD -- frontend/src/pages/MemoDetail.tsx`
> If `MemoDetail.tsx` changed since this plan was written, re-read it fully and
> re-derive the component boundaries before proceeding. This file is under
> active development; expect drift and treat a mismatch as a re-mapping task,
> not an automatic STOP.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/011` and `plans/015` ideally land first (they edit small
  regions of this file; doing them before the split avoids re-pointing their diffs).
- **Category**: tech-debt
- **Planned at**: commit `d847160`, 2026-06-11

## Why this matters

`frontend/src/pages/MemoDetail.tsx` is 1,577 lines holding ~25 state variables and
several unrelated local sub-components (media preview, audio player, music player,
transcript, doc/report card, video panel, the edit form, related items). Every
change means scrolling a 1,500-line file, and unrelated concerns share one render
scope so a fix in one risks another. Splitting into focused files makes the page
navigable and testable without changing any behavior. This is a structural
refactor: **zero behavior change** is the success bar.

## Current state

- One file: `frontend/src/pages/MemoDetail.tsx` (~1,577 lines). It defines the
  route component plus multiple in-file sub-components. Known local components
  (confirm exact names by reading the file — these are the audit's observations):
  `MediaPreview`, `AudioMemoPlayer`, `MusicDetailPlayer`, `AudioTranscript`,
  `DocReportCard`, `VideoContentPanel`, and the inline edit form / notes block.
- Shared rules that constrain the split:
  - `MarkdownEditor` is a single shared component — never create a second one
    (CLAUDE.md). The edit form must keep reusing it.
  - Styling uses `om-*` token classes + `var(--color-*)`; do not introduce Tailwind
    `dark:` utilities or hardcoded colors while moving code.
  - The notes-autosave block (`plans/011`) and pin/delete (`plans/015`) live in
    this file; if those plans landed, their code moves with the relevant section.

## Commands you will need

| Purpose | Command (from `frontend/`) | Expected on success |
|---------|----------------------------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Typecheck+build | `npm run build` | exit 0 |
| Test | `npm test` | all pass |
| Line count | `wc -l frontend/src/pages/MemoDetail.tsx` (from root) | shrinks substantially |

(Windows PowerShell: separate commands with `;`, not `&&`.)

## Scope

**In scope**:
- `frontend/src/pages/MemoDetail.tsx` (becomes a thin shell that composes children)
- `frontend/src/pages/memo-detail/` (new folder for the extracted components)

**Out of scope**:
- Any behavior change, copy change, styling change, or API change. Pure move +
  prop-threading.
- `MarkdownEditor.tsx` (reuse it; never fork it).
- Other pages/components that import `MemoDetail` (the route export must keep the
  same name and default/path).
- Renaming props or changing the route.

## Git workflow

- Branch: `advisor/017-split-memodetail-component`
- Commit per extracted component (e.g. `refactor(memo-detail): extract AudioMemoPlayer`)
  so each move is independently reviewable and revertible. This is safer than one
  giant commit for an L-effort refactor.
- Do NOT push or open a PR unless instructed.

## Steps

> Strategy: extract **one** sub-component at a time, building after each. Never move
> two at once. The codebase must build green between every extraction.

### Step 1: Map the file and decide boundaries

Read `MemoDetail.tsx` end to end. For each local sub-component, record: its name,
the props/state it actually uses, and which hooks/effects belong to it. Produce a
target file list, e.g.:
- `memo-detail/MediaPreview.tsx`
- `memo-detail/AudioMemoPlayer.tsx`
- `memo-detail/MusicDetailPlayer.tsx`
- `memo-detail/AudioTranscript.tsx`
- `memo-detail/DocReportCard.tsx`
- `memo-detail/VideoContentPanel.tsx`
- `memo-detail/MemoEditForm.tsx` (the edit form; keeps using shared `MarkdownEditor`)
- `memo-detail/NotesPanel.tsx` (the autosave notes block, if still inline)

Shared types used across them go in `memo-detail/types.ts` only if needed (prefer
importing from `frontend/src/types`).

**Verify**: a written extraction map. No code changed yet.

### Step 2: Extract the leaf components first (no cross-dependencies)

Start with the most self-contained (e.g. `MediaPreview`, `DocReportCard`). For each:
1. Create the new file; move the component's code verbatim.
2. Add explicit props for everything it previously closed over from the parent
   scope (state, callbacks). Type the props.
3. Import and use it in `MemoDetail.tsx` exactly where it was.
4. Build.

**Verify after EACH extraction**: `npm run build` (from `frontend/`) → exit 0;
`npm run lint` → 0. Do not proceed to the next component on a red build.

### Step 3: Extract the stateful players and transcript

`AudioMemoPlayer`, `MusicDetailPlayer`, `AudioTranscript` own audio element refs,
effects, and listeners. Move each with ITS effects and refs intact (do not split a
component from its cleanup — that would change behavior). Thread the data they need
(the memo, callbacks) as props. These interact with the global audio player
context (`frontend/src/lib/audioPlayer.tsx`) — keep using that context the same way.

**Verify after EACH**: `npm run build` → 0; `npm run lint` → 0.

### Step 4: Extract the edit form and notes

Move the edit form to `MemoEditForm.tsx`, keeping its use of the shared
`MarkdownEditor` (`value`/`onChange`/`onSave` props). If `plans/011` landed, the
notes-autosave block moves to `NotesPanel.tsx` carrying the `lastSyncedNotes`
logic unchanged. If `plans/015` landed, the pin/delete handlers it introduced stay
wired via the `useMemoMutations` hook from wherever they're rendered.

**Verify**: `npm run build` → 0; `npm run lint` → 0.

### Step 5: Reduce MemoDetail to a shell

After extraction, `MemoDetail.tsx` should be a routing/composition shell: fetch the
memo (the `useQuery`), branch on `memo.type`, and render the appropriate
sub-components, passing props. Confirm it is dramatically smaller.

**Verify**: `wc -l frontend/src/pages/MemoDetail.tsx` (from root) → substantially
fewer lines (target: well under ~500; exact number is not a gate, the gate is that
each extracted concern is its own file). `npm run build` → 0.

### Step 6: Full checks + behavior smoke

**Verify** (from `frontend/`): `npm run lint` → 0; `npm run build` → 0; `npm test` → all pass.

Manual behavior smoke (must be identical to before): open a link memo, a document
memo, a voice/audio memo (play it, see the transcript), a music memo (play it), and
a video memo; edit a memo and save; edit notes. Everything renders and behaves as
it did pre-split.

## Test plan

- This is a behavior-preserving refactor; the primary verification is `npm run build`
  + `npm test` staying green after each extraction and the manual smoke above.
- If `plans/018` (component test harness) has landed, add a render smoke test per
  extracted player component (mount with a fake memo, assert it renders without
  throwing). Otherwise skip building a harness here.

## Done criteria

ALL must hold:

- [ ] `frontend/src/pages/memo-detail/` contains the extracted components, one concern per file
- [ ] `MemoDetail.tsx` is a thin composition shell (markedly smaller; `wc -l` confirms)
- [ ] The route export name/path is unchanged (no other importer breaks)
- [ ] `MarkdownEditor` is still the single editor (no second implementation created)
- [ ] No Tailwind `dark:` / hardcoded colors introduced during the move (`grep -rn "dark:" frontend/src/pages/memo-detail/` → none)
- [ ] `npm run lint` / `npm run build` / `npm test` all pass
- [ ] Manual behavior smoke passes for link/doc/audio/music/video + edit + notes
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- A build goes red after an extraction and the cause isn't a missing prop/import
  you can fix in minutes — revert that one extraction and report.
- Splitting a player from its effects/cleanup would change timing/behavior — keep
  them together; if they can't be cleanly separated, report rather than forcing it.
- You find a behavior bug that predates the refactor — note it, do NOT fix it here
  (that would muddy a behavior-preserving change); flag it for a separate plan.

## Maintenance notes

- After this lands, `plans/011`/`plans/015` regions (if not yet done) become small
  edits in their own files instead of needle-in-1500-lines.
- Reviewer should diff with `--color-moved` and confirm moves are verbatim (no
  logic changes hidden in the move).
- Keep the `memo-detail/` folder convention for any future detail-page concern.
