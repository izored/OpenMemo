# ADR-023: Dropping files onto openMemo is a first-class ingest, not a browser accident

**Date:** 2026-07-14 · **Status:** In progress · **Builds on:** ADR-001 (define shared things once), ADR-020 (Spaces isolation), ADR-021 (bottom bar + IslandFab New-Memo flow)

## Context

Today file drop only works inside two surfaces: the New-Memo panel's Media tab (`.om-add-dropzone`) and the Music add-modal. Both require the panel to already be open. Drop a file anywhere else in the app and the **browser** handles it — a dropped video navigates the tab to a raw playback view, a PDF downloads, an image replaces the page. The window never asked openMemo, so openMemo never got a chance to save it.

That is the actual bug: there is no `window`-level drop handler, so the default browser behaviour wins everywhere outside those two dropzones.

I want the WeTransfer / Dropbox feel: drop files **anywhere** on the app and the whole surface lights up and takes them in — one file or many, of any kind — and files them where I already am (inside a Space, inside a collection, on Music) with as few clicks as possible.

## Decision

### 1. One global drop layer, not a target near the +

A small hover target near the New-Memo button would force aim and defeat the "just throw it in" instinct. Instead a single `<FileDropLayer>` mounted in `Layout` (above the routes, inside the providers) owns file drag-and-drop for the whole app.

Window-level listeners (`dragenter` / `dragover` / `dragleave` / `drop`) do two jobs:
- **Kill the hijack.** Whenever the drag carries OS files, `preventDefault()` stops the browser from opening/navigating/downloading them — everywhere, not just over a dropzone.
- **Show the veil.** A full-viewport frosted overlay (`.om-dropveil`) fades in naming the resolved target, e.g. "Drop into 🗂️ Fitness · 3 files".

**Guard against the internal drag.** dnd-kit's card reordering (ADR-021 / MemoGrid → Sidebar) uses pointer events, so its drags carry no `Files` type. The layer engages only when `dataTransfer.types` includes `'Files'`, so dragging a memo card never triggers the veil.

**Yield to the open panel.** When the New-Memo panel or Music add-modal is already open, those own their own dropzones. The global layer suppresses its veil then (it still prevents the browser hijack) so there is never a doubled ingest.

### 2. Two-tier targeting

Drop reads where you already are instead of dumping everything into one blind inbox.

- **Tier 1 — page default (this ADR / first increment).** Dropping anywhere on the page uses that page's ambient context, resolved from the store (`activeSpace`, `activeCollection`) and the route:

  | Where you are | Drop lands in |
  |---|---|
  | Inside a collection (dashboard filter, Space view) | that collection |
  | Inside a Space (no collection open) | that Space |
  | Music page | audio → album / playlist ingest |
  | Bare library, Spaces list, Collections list, memo detail, Ask | library (via the prefill panel — see §4) |

- **Tier 2 — card-precise (follow-up increment).** Dropping directly onto a Space card, a collection card, or a playlist row files into *that* card's target, with the card highlighting under the cursor. Same drag, finer aim, no mode switch. Deferred; the dispatcher in §3 is written to take an explicit target so Tier 2 is only wiring per-card drop handlers to it.

The veil copy always names the resolved Tier-1 target so you see where it will land before releasing.

### 3. Type routing

On drop the file list is inspected once:
- **All audio + on the Music page** → `ingestApi.album` (auto-grouped album/playlist, the Music surface's existing batch path).
- **Everything else** → one memo per file via `ingestApi.file`, uploaded independently so one failure doesn't abort the batch (the existing `onFile` loop semantics).
- **> 1 GiB total** → keep the existing "heads up, large upload" confirm.
- Dragged **text / a link** (no files) is out of scope for the first increment; the layer ignores non-file drags. A later pass can route a dragged URL into the Link tab.

Multi-file is native throughout: `ingestApi.file` is looped and `ingestApi.album` takes an array. The veil shows the count.

### 4. Hybrid commit — instant when the target is clear, prefill when it is not

What happens the instant you release depends on whether there is an unambiguous bucket:

- **Instant ingest** when you are inside a **collection**, inside a **Space**, or on the **Music** page. The files upload straight to that target; a progress pill shows `Uploading n / total`, then a branded notice confirms (or reports partial failure). Zero clicks. This is the WeTransfer feel.
- **Prefill the New-Memo panel** when the surface is ambiguous — the bare library, the Spaces / Collections lists, a memo detail, the Ask page. The dropped files are staged into the panel (opened to the Media tab), so you pick a collection and add tags before Save. One extra, deliberate click, full control.

The handoff for the prefill path is a store slice `pendingDropFiles: File[] | null`. `FileDropLayer` sets it and opens the panel (`setAddPanelOpen(true)`, which also drives the IslandFab open on bottom-bar pages); `AddMemoPanel` consumes it, switches to the Media tab, stages the files as "ready to add", and clears the slice. Save uploads the staged files through the same `onFile` path.

## Constraints (must respect)

- **Only engage on `dataTransfer.types` including `'Files'`.** This is the one line that keeps dnd-kit card reordering and any future internal HTML5 drags from raising the veil.
- **`preventDefault()` on `dragover` AND `drop`** — both are required or the browser still opens the file. `dragover` must also set `dropEffect = 'copy'` for the correct cursor.
- **Flicker-free enter/leave.** `dragenter`/`dragleave` fire per descendant as the pointer moves over child nodes. Track a depth counter and only hide the veil when it returns to zero.
- **Suppress while a panel owns the drop.** When `addPanelOpen` or `musicModalOpen` is true, the layer does not ingest (the panel's own dropzone does) — it only prevents the browser hijack.
- **`activeSpace` is route-derived, not persisted** (ADR-020). Read it live from the store at drop time; don't cache it in the listener closure.
- **No backend work.** Every ingest endpoint (`/ingest/file`, `/ingest/album`) already exists and already takes `collection_id` + `workspace_id`.

## Components

- `frontend/src/components/FileDropLayer.tsx` — the global veil + window listeners + drop dispatcher. Mounted in `Layout`.
- `frontend/src/lib/fileDrop.ts` — pure helpers: read files off a `DataTransfer`, resolve the Tier-1 target from route + store, classify files for type routing.
- `frontend/src/components/AddMemoPanel.tsx` — consumes `pendingDropFiles` for the prefill path (stage on the Media tab).
- `frontend/src/stores/appStore.ts` — `pendingDropFiles` slice for the layer → panel handoff.
- `frontend/src/styles/openmemo.css` — `.om-dropveil` classes (reuse the `.om-add-dropzone` dashed-target visual language).

## Resolved (first increment)

1. **Scope of this increment → global layer + Tier-1 page-default targeting + type routing + hybrid commit.** Tier-2 per-card drop targets are a follow-up; the dispatcher already accepts an explicit target so they only need per-card wiring.
2. **Overlay vs. hover target → global full-window veil.** Fixes the hijack uniformly and matches the referenced WeTransfer/Dropbox model.
3. **Commit model → hybrid.** Instant inside a clear bucket, prefill on ambiguous surfaces.

## Open (follow-up)

- Tier-2 per-card drop targets (Space cards, collection cards, playlist rows).
- Dragged URL / text → Link tab.
- Folder (directory) drops via `webkitGetAsEntry` recursion.
