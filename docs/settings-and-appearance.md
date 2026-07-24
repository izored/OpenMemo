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
│  Local AI             │  Phone capture         │  ← masonry, packs tight
│  Browser extension    │  Made by               │
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

The **Phone capture** card (ADR-020) holds the Telegram relay: enable toggle
(disabled until a token is stored), write-only bot token field (only a presence
flag ever comes back), a "Pull media locally" toggle for forcing downloads on
bot saves, and the poll cadence select. Its status line reads the live relay
state from `/api/settings/telegram/status`.

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
Grid columns, Gutter, Background, Animation speed.

**Gutter** is a 0–40px slider (`tweaks.gutter`) for the space between memo tiles,
applied to every card style — pull it to 0 on Edge for a gapless wall, or open it
up for breathing room. Existing layouts keep their old spacing on first load
(Edge stayed gapless, the rest at the roomy 28px) until the slider is moved.

**Color picks** (custom accent slots, background Color mode) open the in-app
`ColorPicker` (`components/ColorPicker.tsx`) — an SV square + hue bar + hex field
styled to the app — instead of the native `<input type="color">` OS dialog.

**Sliders** all use `.om-ap-range`: the track is drawn on the runnable-track with
the input padding-insetting the thumb radius, so the handle never clips at the
ends, and a `--pct` inline var fills the track to the value's position.

### Accent contrast (`--accent-ink`)

Any accent can be set, including a pale lime or yellow that looks fine as a fill
(white text rides on it via `--accent-text`) but disappears when the accent is
used as a *foreground* on a surface — e.g. the audio-card waveform bars on a
light tile. `applyTweaks()` derives a contrast-safe `--accent-ink` per theme
(`accentInk()` in `lib/appearance.ts`): it deepens a too-pale accent on light
backgrounds and lifts a too-dark one on dark, keeping hue and saturation, and
leaves well-balanced mid accents untouched. Foreground accent uses (the waveform,
the branded rail scrollbar) read from `--accent-ink` so they stay legible on any
accent (OPNMMO-0040). It is a reusable token for future accent-on-surface needs.

### Background

Two modes: **Random** (an accent-derived gradient wash) and **Image**.

Image mode opens a gallery of the built-in wallpapers shipped in
`frontend/src/assets/bg/`, plus an **upload-your-own** tile at the end. Each
built-in is named with its intent baked in:

```
<Color> - <Theme> - <Name> - <NN>.<ext>
e.g.  Blue - Dark - Syntone - 24.jpg
```

Picking one applies all three at once — the wallpaper, the matching **accent**,
and the matching **light/dark theme** — so the UI always suits its background.
`bgPresets.ts` reads the convention: the color word maps to an accent hex
(blue/green/orange/yellow reuse the standard accents; purple → `#B79CED`,
rose → `#E8889C`), the theme word maps to light/dark. Drop a correctly-named
image into `assets/bg/` and it shows up in the gallery — no code change.

What persists is `tweaks.bgPreset`, the **filename stem** (a stable id), not the
hashed bundle URL. `applyTweaks` resolves the current URL from that id, so a
rebuild's new asset hash can't break a saved pick. An uploaded image instead
stores its server URL in `bgImage` with `bgPreset` empty; **Remove** clears
either.

### Creator preferences

The options the creator runs openMemo with carry a small **fixed-red** asterisk
(`.om-ap-star`, `#FF4D4D`). It is deliberately *not* the accent color: an accent
asterisk vanished into the accent-filled active segment and shifted with every
theme, so it now stays the same readable red on any segment, theme, or accent
(OPNMMO-0039).

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

## Context window

Below the model picker, a **Context window** field sets Ollama's `num_ctx` (the
tokens per AI call) for every chat and summary. Type a number to override the
backend default; leave it `0` to use `OLLAMA_NUM_CTX` (8192). It is persisted
server-side (`app_settings.json` → `num_ctx`) and read at call time by
`OllamaClient`, so the backend's own summary calls use the same value with no
restart. The server clamps it to 512–131072. Raise it for long transcripts if
your RAM allows; lower it on a small box.

---

## Where it lives

| File | What |
|---|---|
| `frontend/src/pages/SettingsPage.tsx` | The bento page, stat strip, cards, model picker, built-with marquee |
| `frontend/src/components/AppearancePanel.tsx` | The live-preview panel, creator-pref asterisks, live badge |
| `frontend/src/lib/appearance.ts` | Theme / accent / background math applied to `<html>` |
| `frontend/src/lib/bgPresets.ts` | Bundles `assets/bg/` wallpapers, parses the `Color - Theme - Name` filename into accent + theme |
| `frontend/src/assets/bg/` | The built-in background wallpapers, named by the convention above |
| `frontend/src/styles/openmemo.css` | All of the above styling (search `om-ap-hero`, `om-settings-masonry`, `om-stat-`, `om-model-select`) |

---

## Theme reference

`data-theme` on `<html>`: Light is `light`, Dark is `hi` (System resolves to one
of the two). See `memo-card-visual-system.md` for the full theme + transition
system.
