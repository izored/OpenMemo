# ADR-021: The bottom bar is the shared page chrome, and the New Memo button is a Dynamic Island

**Date:** 2026-06-19 · **Status:** Shipped · **Supersedes:** ADR-016 (one shared PageHeader) · **Builds on:** ADR-001 (define shared things once), ADR-020 (sidebar layout, background modes)

## Context

ADR-016 put one shared `PageHeader` at the top of every page: a sticky title row with filter tabs. I am replacing it with a floating bar pinned to the bottom of the content area. Same idea as ADR-016 (one shared shell, never per-page markup), moved to the bottom and made composable.

Why bottom, why now: the header ate vertical space at the top of every page and the filter tabs were text-heavy. I want a quieter, icon-first control surface that floats over the content, works on my phone, and can carry per-page or per-flow controls (the Music flow needs different controls than the library). A header is a fixed shape; I want a slot system that evolves.

## Decision

### One shared shell, slot-based

`<BottomBar>` is the single shell, rendered by each page (like `PageHeader` was). It is a floating pill, glass-blurred, centered horizontally **within the content area** (sidebar-aware, not the full viewport), pinned to the bottom. Framer Motion drives every transition.

Layout, left to right:
- **Leading (fixed):** the settings cog + a hairline separator. Cog navigates to `/settings`. Always present.
- **Center (scrollable slot):** `children`. Pages drop their controls here. On the Dashboard that is the icon-only memo-type filters. The slot scrolls horizontally, with auto-scroll on edge hover and fade hints.
- **Trailing (fixed):** the `fab` slot. A rounded-square action button. On the Dashboard it is New Memo.

Slot API (current): `label?` (a one-line caption above the bar, e.g. the date or collection name), `children?` (the scrollable center), `fab?` (the trailing button). This is the evolution seam: new pages/flows pass different `children` and `fab`, never fork the shell.

### The active-filter pill

Filters are icon-only. The active one is marked by a single pill that slides between icons using a shared Framer Motion `layoutId` ("om-bbar-pill"). The pill is shared with the cog too, so it can travel the whole bar.

### The New Memo button is a Dynamic Island

This is the contested part and the reason for this ADR.

The FAB is not a button that *opens* a modal somewhere else. The FAB **is** the New Memo modal, collapsed. Clicking it:
1. The little rounded square **morphs/grows into the full New Memo modal**, iOS-Dynamic-Island style. It grows from the FAB's own corner, not from the page corner.
2. At the same time the **bar shrinks**: the filters disappear and the bar collapses to just the cog.
3. Closing reverses it: the modal collapses back into the FAB, the bar re-expands with its filters.

Anchor: the modal's bottom-right corner sits at the FAB's bottom-right corner. It grows up and to the left from there.

## Constraints discovered (must respect in the redo)

- **`.om-add-panel` is shared by THREE components**: `AddMemoPanel` (New Memo), `MusicAddModal` (`.om-mm-panel`), `AppearancePanel` (`.om-ap-panel`). They all reuse the `.om-add-panel` base class for the glass card + its open/close transform animation (`transform: scale(0.2)…; opacity:0` → `.open { transform:none; opacity:1 }`). **Any change to `.om-add-panel`'s open animation hits all three.** A previous attempt stripped that transform to hand the animation to Framer Motion and made all three panels render visible at once. The morph work must NOT touch the shared `.om-add-panel` open animation, or must give the other two their own non-shared class first.
- **The bar lives inside `.om-main`** (the scroll container), as `position: sticky; bottom: 0`, inside a `.om-bbar-page` flex column that fills `.om-main`. That is what makes it sidebar-aware and bottom-pinned. Do not switch it back to `position: fixed` against the viewport (that ignored the sidebar and mis-centered the bar).
- **The global FAB in `Layout.tsx`** (`.om-fab`) still exists for pages without a bottom bar. On a bottom-bar page it is hidden via `body.om-has-bbar .om-fab { display: none }`. The New Memo store flag is `addPanelOpen`. The Music page's global FAB opens `musicModalOpen` instead.
- **Keyboard `N`** opens New Memo from anywhere (`setAddPanelOpen(true)` in `Layout.tsx`).
- **dnd-kit** `distance: 8` activation must be preserved if filters ever get drag-reorder again (currently order is applied without the drag UI).

## Components

- `frontend/src/components/BottomBar.tsx` — the shell (cog, separator, scroll slot, fab slot, auto-scroll).
- `frontend/src/components/BottomBarFilters.tsx` — Dashboard's icon filters for the center slot.
- `frontend/src/pages/Dashboard.tsx` — composes `BottomBar` with filters + the New Memo FAB.
- `frontend/src/components/AddMemoPanel.tsx` — the New Memo form (the thing the FAB grows into).
- `frontend/src/styles/openmemo.css` — `.om-bbar-*` classes.

## Resolved (2026-06-19)

1. **Morph fidelity → TRUE single-surface morph.** One element is the button collapsed and the modal expanded. The form content lives inside the growing box and fades in. Built as `<IslandFab>`: a `position: relative` 50×50 footprint in the bar's trailing slot, holding one `motion.div` (`.om-island`) pinned `bottom:0; right:0` with Framer Motion `layout`. Collapsed it is the 50×50 rounded square showing the `+`. Open it renders the form (`<AddMemoPanel embedded>`), and `layout` animates the box from 50×50 up and to the left into the full modal. Bottom-right stays pinned, so it grows out of the button's own corner.
2. **Scope → every bottom-bar FAB.** New Memo (Dashboard) and Add-music (Music page) both use `<IslandFab>`. The expanded content differs per page; the shell is one component.
3. **Mobile → full-width bottom sheet.** Below 768px the open `.om-island` switches to `position: fixed; left:0; right:0; bottom:0; width:100%` with rounded top corners. The collapsed button is unchanged.
4. **Bar while open → shrinks to the cog.** The page passes `children={open ? null : <controls>}`, so the center slot empties and the `motion.div` bar `layout`-animates down to the cog. The cog stays clickable. The bar stays sticky at the bottom of the content area. The FAB's 50×50 footprint stays in the row (the island grows out of it).
5. **Dismiss → click-outside (primary), plus the modal's own X / Cancel and Esc.** Each plays the collapse-back-into-button animation (the same `layout` transition in reverse).
6. **Experiment: open on hover.** On pointer devices, hovering the collapsed FAB expands it; leaving collapses it, unless an input inside has focus or the user clicked to pin it. Flagged `hoverOpen` on `<IslandFab>` so it can be removed in one line if it feels twitchy. No-op on touch (no hover events).

## Shared-surface rule (consequence of the constraint above)

`.om-add-panel`'s open animation stays untouched. The corner `AddMemoPanel` / `MusicAddModal` / `AppearancePanel` keep working as-is for pages WITHOUT a bottom bar. On bottom-bar pages a store flag `bottomBarPresent` makes the global `AddMemoPanel` / `MusicAddModal` render `null`; the island renders the same component with an `embedded` prop (no fixed aside, no scale animation — the island owns the surface and the motion).
