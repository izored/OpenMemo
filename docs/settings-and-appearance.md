# Settings & Appearance

How the Settings page is laid out and how the live appearance panel works. This
is a reference for deliberate design decisions, not just what the code does. See
ADR-011 for the why.

---

## The Settings bento

The page is a vertical stack of full-width feature blocks with a masonry of the
smaller cards in the middle. Source order is reading order.

```
┌──────────────────────────────────────────────┐
│  Appearance hero (full width)                  │  ← the headline feature
├──────────────────────────────────────────────┤
│  Stats strip: Memos · Collections · Tags ·     │
│  This week · On disk        (5 tiles, full)    │
├───────────────────────┬──────────────────────┤
│  Profile              │  Files & limits        │
│  Local AI             │  Made by               │  ← masonry, packs tight
│  Browser extension    │                        │
├──────────────────────────────────────────────┤
│  Built with (full-width marquee)               │
├───────────────────────┬──────────────────────┤
│  Backup & Restore     │  Danger zone           │  ← half-width duo
└───────────────────────┴──────────────────────┘
```

Containers:

| Class | Role |
|---|---|
| `om-bento-stack` | Outer vertical stack (flex column) |
| `om-ap-hero` | Appearance hero block |
| `om-stat-strip` | Five-tile stats grid |
| `om-settings-masonry` | CSS multi-column masonry of the mid cards |
| `om-duo` | Two-column grid for Backup + Danger |

The masonry is `columns: 2` with `break-inside: avoid` on each card, so a short
card is hugged by the next one instead of stretching to fill a row. It is named
`om-settings-masonry`, not `om-masonry`, because the memo grid already owns the
latter (a flex-based masonry).

---

## The appearance hero

The live appearance preview is the page's hero, not a buried CTA.

- A full-width panel with its own surface. In dark themes it is a deep panel
  (`#15131B`); in light it is white. Either way the user's accent is the only
  color, used on the CTA.
- Clicking anywhere on it jumps to All Memos and opens the live-preview panel.
- A secondary "Replay product tour" link sits beside the CTA.
- A mini window mock on the right hints at the grid being themed.

Behaviour:

| Interaction | Result |
|---|---|
| Switch theme | Background cross-fades (solid `background-color`, so the global theme transition catches it; a gradient would jump) |
| Hover the section | "Open live preview" CTA inverts its color scheme |
| Hover "Replay product tour" | The CTA flips back to its original scheme (`:has()`) |

There is no accent glow blob inside the card. Depth comes from a fixed `::before`
sheen that is identical in both themes, so it never causes a jump on switch.

---

## Stats strip

Five tiles that always render. Each shows a shimmer skeleton (`om-stat-skel`)
while the stats fetch is in flight, then the number fades in. Because the tiles
are present from first paint, the row reserves its height and the page does not
jump when the data lands.

---

## The live appearance panel

Opened from the hero (or the sidebar). Everything previews live as you change it,
written to the persisted `tweaks` in the app store and applied to `<html>`.

Controls: Theme, Accent (with two custom slots), Card style, Layout, Player size,
Grid columns, Background, Animation speed.

### Creator preferences

The options the creator runs openMemo with carry a small accent asterisk:

| Setting | Marked pick |
|---|---|
| Card style | Minimal* |
| Layout | Boxed* |
| Player size | Big* |

The panel footer carries the key, in the creator's voice: *"\* My picks. This is
how I run openMemo, and how it looks best to me."* It is a hint only. The actual
defaults are unchanged and nothing is forced.

### Live badge

The header "live" badge has a pulsing accent dot (`om-ap-live`), so the panel
reads as actively previewing. Honors `prefers-reduced-motion`.

---

## Default model

The Local AI card has an in-brand dropdown (`om-model-select`) to choose the
default chat model. It writes the persisted `chatModel` in the app store, which
every Ask and chat surface already reads, so it is the single app-wide default
with no backend change and nothing to keep in sync.

---

## Where it lives

| File | What |
|---|---|
| `frontend/src/pages/SettingsPage.tsx` | The bento page, stat strip, cards, model picker, built-with marquee |
| `frontend/src/components/AppearancePanel.tsx` | The live-preview panel, creator-pref asterisks, live badge |
| `frontend/src/lib/appearance.ts` | Theme / accent / background math applied to `<html>` |
| `frontend/src/styles/openmemo.css` | All of the above styling (search `om-ap-hero`, `om-settings-masonry`, `om-stat-`, `om-model-select`) |

---

## Theme reference

`data-theme` on `<html>`: Light is `light`, Dark is `hi` (System resolves to one
of the two). See `memo-card-visual-system.md` for the full theme + transition
system.
