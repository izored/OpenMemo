# ADR-023: Dropping files onto openMemo is a first-class ingest, not a browser accident

**Date:** 2026-07-14 · **Status:** In progress · **Amended:** 2026-08-29 (increment 2, browser drags) · **Builds on:** ADR-001 (define shared things once), ADR-020 (Spaces isolation), ADR-021 (bottom bar + IslandFab New-Memo flow)

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

- **Tier 1 — page default (this ADR / first increment).** Dropping anywhere on the page uses that page's ambient context, resolved from the store (`activeSpace`, `activeCollection`) and the route. Since 3.14.1 both of those slices are re-derived FROM the route (`/space/:id`, `/collection/:id`, `/space/:id/collection/:collectionId`), so the drop target and the address bar can no longer disagree:

  | Where you are | Drop lands in |
  |---|---|
  | Inside a collection (`/collection/:id`, or a Space's) | that collection |
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
- Dragged **text / a link** (no files) was out of scope for the first increment. Increment 2 handles it; see §5.

Multi-file is native throughout: `ingestApi.file` is looped and `ingestApi.album` takes an array. The veil shows the count.

### 4. Hybrid commit — instant when the target is clear, prefill when it is not

What happens the instant you release depends on whether there is an unambiguous bucket:

- **Instant ingest** when you are inside a **collection**, inside a **Space**, or on the **Music** page. The files upload straight to that target; a progress pill shows `Uploading n / total`, then a branded notice confirms (or reports partial failure). Zero clicks. This is the WeTransfer feel.
- **Prefill the New-Memo panel** when the surface is ambiguous — the bare library, the Spaces / Collections lists, a memo detail, the Ask page. The dropped files are staged into the panel (opened to the Media tab), so you pick a collection and add tags before Save. One extra, deliberate click, full control.

The handoff for the prefill path is a store slice `pendingDropFiles: File[] | null`. `FileDropLayer` sets it and opens the panel (`setAddPanelOpen(true)`, which also drives the IslandFab open on bottom-bar pages); `AddMemoPanel` consumes it, switches to the Media tab, stages the files as "ready to add", and clears the slice. Save uploads the staged files through the same `onFile` path.

### 5. Increment 2: a drag out of a browser is the same ingest

The first increment engaged only on `dataTransfer.types` including `'Files'`, which is exactly right for a Finder or Explorer drag and exactly wrong for the other half of the gesture. Dragging a link, an image or a selection **out of a web page** hands over no file at all. It hands over strings: `text/uri-list`, `text/html` (the dragged node's own markup) and `text/plain`. The layer saw no `'Files'`, returned early, skipped its `preventDefault()`, and the browser took the event back and navigated the whole app to the dropped URL. Reported as "drag and drop from a site does not work"; what it actually did was worse than nothing.

Both shapes are first-class now.

**Detection is separate from extraction, because the spec says so.** During `dragenter` / `dragover` only `dataTransfer.types` is readable. The strings themselves are unreadable until the `drop` event fires (protection against a page snooping on a drag passing over it). So `dragHasText()` answers "is this ours" from types alone, and `payloadFromDataTransfer()` reads the payload inside the drop handler.

**Which URL wins.** A dragged image carries the page it sits on in `text/uri-list` and the picture itself in the `<img src>` inside `text/html`. The markup wins there, because saving the page instead of the picture is the difference between a memo of the photo and a memo of the gallery around it. Otherwise the order is `text/uri-list`, then links found in the markup, then any http(s) URL found in `text/plain`. Everything is deduped, and the markup is read with `DOMParser` rather than a regex: a dragged node's `src` routinely contains the quotes and entities a regex trips over.

**Routing follows §3 and §4 unchanged.**

| Dropped | Target clear (collection / Space) | Target ambiguous |
|---|---|---|
| One link | `ingestApi.url` into that bucket | Link tab, prefilled |
| Several image links | `ingestApi.gallery`, one carousel memo | Link tab, one per line |
| Several mixed links | one memo per link | Link tab, one per line |
| A link on the Music page | `ingestApi.url` with `audioOnly` | n/a |
| A text selection, no link | always the Note tab, prefilled | Note tab, prefilled |

A dragged selection is never an instant ingest even inside a collection: a note needs a title, which is a question only the panel can ask.

**The internal-drag guard had to change.** §3's `'Files'` check was doing double duty as the "this is not an internal drag" guard. It cannot any more: anchors and images inside openMemo are natively draggable, so dragging a memo card's link across the app produces a `text/uri-list` drag indistinguishable from one out of Chrome. The layer now tracks a `dragstart` on `window`: a drag that STARTED in this document is never an import. It is still `preventDefault()`ed on drop, because letting it through navigates the app to the dragged href. (dnd-kit's card reorder is pointer-driven and carries no `DataTransfer` at all, so it never reaches any of this.)

## Constraints (must respect)

- **Engage on `'Files'`, or on a text drag that did not start inside this document.** The `'Files'` check alone used to be the internal-drag guard; since increment 2 a `dragstart` seen on `window` is what marks a drag as internal. dnd-kit card reordering is pointer-driven and carries no `DataTransfer`, so it never reaches the layer either way.
- **A file drag must not also count as a link drag.** Some platforms attach a `text/plain` filename to a Finder drag; `dragHasText()` returns false whenever `'Files'` is present, or one drop would ingest twice.
- **`getData()` only works inside `drop`.** Detect from `types` during enter/over; read the payload on drop.
- **`preventDefault()` on `dragover` AND `drop`** — both are required or the browser still opens the file. `dragover` must also set `dropEffect = 'copy'` for the correct cursor.
- **Flicker-free enter/leave.** `dragenter`/`dragleave` fire per descendant as the pointer moves over child nodes. Track a depth counter and only hide the veil when it returns to zero.
- **Suppress while a panel owns the drop.** When `addPanelOpen` or `musicModalOpen` is true, the layer does not ingest (the panel's own dropzone does) — it only prevents the browser hijack.
- **`activeSpace` is route-derived, not persisted** (ADR-020). Read it live from the store at drop time; don't cache it in the listener closure.
- **No backend work.** Every ingest endpoint (`/ingest/file`, `/ingest/album`) already exists and already takes `collection_id` + `workspace_id`.

## Components

- `frontend/src/components/FileDropLayer.tsx` — the global veil + window listeners + drop dispatcher. Mounted in `Layout`.
- `frontend/src/lib/fileDrop.ts` — pure helpers: read files or link/text payloads off a `DataTransfer`, resolve the Tier-1 target from route + store, classify files and URLs for type routing. Covered by `fileDrop.test.ts`.
- `frontend/src/components/AddMemoPanel.tsx` — consumes `pendingDropFiles` (stage on the Media tab) and `pendingDropLinks` (Link tab, one URL per line, which is the multi-link shape the tab already parses; or the Note tab for a dragged selection).
- `frontend/src/stores/appStore.ts` — `pendingDropFiles` and `pendingDropLinks` slices for the layer → panel handoff.
- `frontend/src/styles/openmemo.css` — `.om-dropveil` classes (reuse the `.om-add-dropzone` dashed-target visual language).

## Resolved (first increment)

1. **Scope of this increment → global layer + Tier-1 page-default targeting + type routing + hybrid commit.** Tier-2 per-card drop targets are a follow-up; the dispatcher already accepts an explicit target so they only need per-card wiring.
2. **Overlay vs. hover target → global full-window veil.** Fixes the hijack uniformly and matches the referenced WeTransfer/Dropbox model.
3. **Commit model → hybrid.** Instant inside a clear bucket, prefill on ambiguous surfaces.

## Resolved (increment 2)

4. **Browser drags are in scope after all.** A link, an image or a selection dragged out of a web page is the same ingest as a file, routed by the same Tier-1 target and the same hybrid commit. See §5.
5. **The internal-drag guard is a `dragstart` flag, not the `'Files'` check.**

## Open (follow-up)

- Tier-2 per-card drop targets (Space cards, collection cards, playlist rows).
- Folder (directory) drops via `webkitGetAsEntry` recursion.
