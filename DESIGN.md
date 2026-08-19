# openMemo Design System

The visual contract for openMemo's frontend. Source of truth is
`frontend/src/styles/openmemo.css` (tokens, ~1000 `om-*` classes),
`typeset.css` (rendered markdown), `fonts.css` (the local Satoshi faces) and
`frontend/src/lib/appearance.ts` (what the Appearance panel writes onto
`<html>` at runtime).

If this file and the CSS disagree, the CSS wins and this file is the bug.

---

## 1. The one rule that breaks things

**The theme is an attribute, not a class and not a media query.**

`applyTweaks()` sets `document.documentElement.dataset.theme` to either
`light` or `hi`. There is no `.dark` class anywhere, and
`prefers-color-scheme` is only read once, to resolve the `system` setting into
one of those two values.

Consequences, all of them load-bearing:

- Tailwind's `dark:` variant never matches. `prose dark:prose-invert`,
  `text-white`, `bg-[#111]` and plain `prose` render broken in at least one
  theme. This is what broke the markdown editor.
- Any new component reads `var(--*)` tokens. The tokens are redefined per
  theme, so a component written against them adapts for free.
- Tailwind is being phased out. Do not add new utilities. When you touch a
  component that still uses them, migrate it to `om-*` plus tokens.

The two themes are `light` and `hi`. `hi` is the inky high-contrast dark; the
Appearance panel calls it Dark. There is no third theme.

---

## 2. Accent, and why every surface moves with it

The accent is user-chosen. Default `#F4825A`. Everything else is derived from
it at runtime:

| Variable | Derivation | Use |
|---|---|---|
| `--accent` | user's hex | the raw brand colour |
| `--accent-deep` | `shade(accent, -28)` | pressed states, deep fills |
| `--accent-soft` | `shade(accent, +28)` at `20` alpha | tints, hover washes |
| `--accent-text` | `#1A1A1C` if luminance > 0.62, else `#FFFFFF` | text painted **on** the accent |
| `--accent-ink` | theme-aware safe variant | accent used **as** foreground on a surface |

`--accent-text` and `--accent-ink` are not interchangeable. Text sitting on an
accent-filled button takes `--accent-text`. An accent-coloured icon or waveform
bar sitting on a normal surface takes `--accent-ink`. Reaching for raw
`--accent` as a foreground colour makes pale accents vanish on light and dark
accents vanish on dark.

Surfaces are mixed with the accent at 3 to 7 percent via `color-mix(in oklab,
...)`, which is why choosing a new accent tints the sidebar, the cards and the
document surfaces rather than just recolouring one button. Keep the tint
subtle. Anything above roughly 8 percent stops reading as a neutral surface.

---

## 3. Token ladders

Both themes define the same names. Never hardcode a hex where a token exists.

### Surfaces, back to front

`--bg` → `--bg-rail` → `--surface` → `--surface-2` → `--surface-3` → `--elev`

`--bg` is the page. `--bg-rail` is the sidebar. `--surface` through
`--surface-3` step forward inside a card. `--elev` is for anything floating
(modals, toasts, popovers), and pairs with `--shadow-elev`.

### Text, by emphasis

`--text` → `--text-2` → `--text-3` → `--text-4`

Primary, secondary, tertiary, faint. In light theme the text tokens are
deliberately **not** accent-tinted, so counts and the pinned dot stay a proper
near-black. Do not "fix" that asymmetry.

### Borders

`--border` (hairline, default) and `--border-2` (emphasis, focus, hover).

### Shadows

`--shadow-card`, `--shadow-card-hover`, `--shadow-elev`. Each carries an inset
highlight line as its first layer. That inset is what stops cards looking flat
against a tinted background, so keep it when composing a new shadow.

`--grain` is an inline SVG turbulence overlay at ~4 percent. It sits on large
surfaces and is the reason flat fills do not band.

---

## 4. Geometry

```
--r-xs   6px     chips, tiny pills
--r-sm  10px     buttons, inputs
--r-md  14px     cards, textareas
--r-lg  20px     panels
--r-xl  28px     modals, large sheets
--r-2xl 32px     hero surfaces
```

There is no single universal radius. Pick by element size: a 6px radius on a
modal reads as broken, a 32px radius on a chip reads as a lozenge.

`999px` is used only where something is genuinely a pill (badges, tags,
toggles).

Spacing: `--pad-card: 20px`, `--gap-card: 14px`. Page width is `--page-max:
1180px` under `data-layout="boxed"` and unbounded under `data-layout="full"`.
The shared `PageHeader` (`om-header`) owns the 48px top spacing, so pages must
not add their own top padding or titles fall off the shared baseline.

---

## 5. Typography

Satoshi, served from `/fonts` by `fonts.css`. The faces are fetched at build
time by `scripts/fetch-fonts.mjs`. Rendering openMemo makes no font network
request at all, and that is intentional: it is part of the local-first
guarantee. If the woff2 files are missing the stack falls through to the system
sans, which is legible and wrong rather than broken.

| Token | Value | Use |
|---|---|---|
| `--font-ui` | Satoshi | all interface text |
| `--font-display` | Satoshi (or the chosen display face) | titles, hero |
| `--font-mono` | **Satoshi with tabular numerals** | brand meta labels, counts, timers |
| `--font-code` | real monospace stack | markdown `code`/`pre`, code blocks |

`--font-mono` is not monospace. It is the brand meta-label face. Every session
that "fixes" it to a monospace stack breaks the meta rows. Actual code uses
`--font-code`.

Three type pairs ship, selectable in Appearance: `satoshi` (both roles
Satoshi), `general` (General Sans), `cabinet` (Cabinet Grotesk display over
Satoshi UI).

### One type token per role

All variants of a repeating component use the same size token for the same
role. Every card title takes the card-title size, whatever the card type.
Per-variant drift reads as a bug, not as variety.

---

## 6. Rendered markdown: typeset.css

`typeset.css` owns everything that renders user or model markdown. `.om-prose`
is kept as an alias of `.typeset`, so existing markup keeps working.

Three variables drive the whole rhythm. Presets tune only these:

```
--typeset-size      14px      base size; headings/code/tables derive in em
--typeset-leading   1.7       line height
--typeset-flow      0.86em    space between blocks
```

Headings are em-derived so they follow the base size: `h1` 1.57em, `h2` 1.29em,
`h3` 1.07em, `h4`–`h6` 0.96em, all at weight 600 with `-0.015em` tracking.

Element rules use `:where()`, which is zero specificity, so any `om-*` rule or
utility overrides them without `!important`. Keep that property when adding
rules: write `:where(.typeset, .om-prose) foo`, never `.typeset foo`.

`.om-prose-chat` is the chat preset. Add a preset by overriding the three
variables, not by rewriting element rules.

---

## 7. Components

### Buttons

| Class | Height | Radius | Fill | Role |
|---|---|---|---|---|
| `om-btn-primary` | 36px | 10px | `--text` on `--bg` | the one main action |
| `om-btn-secondary` | 30px | 8px | `--surface-2` + `--border` | everything else |
| `om-btn-ghost` | 36px | 10px | `--surface` + `--border` | low-emphasis, toolbars |
| `om-btn-danger` | inherits | inherits | `#dc2626` | destructive confirm |

Primary inverts: it paints the text colour as its background. That is what
makes it the loudest thing on the page without introducing a second brand
colour.

Fixed-height buttons carry `white-space: nowrap`. A squeezed flex row once
folded "Play all" onto two lines and spilled it out of the 36px box.

### Shared classes keep symmetric padding

`om-btn-primary` is `padding: 0 14px`. The trailing-chip exception is expressed
conditionally:

```css
.om-btn-primary:has(.om-kbd-inv) { padding-right: 6px; }
```

That is the pattern. Never bake a content-specific asymmetric padding into a
shared class. Doing it once left three later buttons cramped on the right
before anyone found the cause. If a button "looks cramped", check the shared
class's computed padding on both sides before patching the instance.

### Inputs

`om-input`: `--surface-3`, 8px radius, 6/10 padding, 13px, border moves to
`--border-2` on focus. `om-textarea`: `--surface`, 12px radius, 10/14 padding,
`--font-ui`, 1.5 leading, no resize handle.

Focus is a border colour change, not an outline ring.

---

## 8. Appearance attributes on `<html>`

`applyTweaks()` writes all of these. A component can branch on any of them.

| Attribute | Values | Meaning |
|---|---|---|
| `data-theme` | `light`, `hi` | the theme |
| `data-card` | `normal`, `minimal`, `edge` | card treatment |
| `data-layout` | `boxed`, `full` | page max width |
| `data-density` | `roomy` | spacing (currently always roomy) |
| `data-bg` | `none`, image, cloud, colour | background mode |

Plus runtime variables for the background: `--bg-image`, `--bg-blur`,
`--bg-c1..c3`, `--bg-p1x..p4y` (blob positions), `--bg-solid`, `--cloud-blur`,
`--sky-top`, `--sky-bottom`, `--sky-stop`, `--blob-duration`,
`--blob-play-state`.

The cloud shader always paints a static sky gradient underneath the WebGPU
canvas, so a missing or still-booting shader shows a day-appropriate sky rather
than a blank panel. Any future canvas background does the same. Graceful
fallback is mandatory, not optional.

---

## 9. Do and do not

### Do

- Read `var(--*)` tokens for every colour, radius and shadow.
- Pick the radius from the element's size, using the `--r-*` ladder.
- Use `--accent-text` on the accent, `--accent-ink` for accent-as-foreground.
- Keep the inset highlight when composing a shadow.
- Use `:where()` for anything in `typeset.css`.
- Give music and media-first cards a full-bleed cover with the title overlaid
  on a bottom gradient.
- Portal any dropdown that lives inside a `BorderBeam`. `isolation: isolate`
  plus `backdrop-filter` traps child menus. Portal to body, `position: fixed`,
  z-index around 400.
- Keep the mobile `@media` block **last** in `openmemo.css`. It is last so it
  wins. Moving it silently breaks the responsive pass.

### Do not

- Do not add Tailwind utilities, and never a `dark:` variant. It cannot match.
- Do not use a coloured left-edge bar as an active-state indicator. No
  `border-left`, no `::before` edge accent, no `box-shadow: inset 2px 0 0`.
  Active states are a background tint, a text-colour shift, or an icon accent.
- Do not hardcode a hex where a token exists.
- Do not bake asymmetric padding into a shared class.
- Do not use a different size token per variant of the same component role.
- Do not make an expensive or bulk action the default. The smallest action is
  the default; the expensive one is an explicit, unchecked opt-in.
- Do not add a page-level "add" button. Adding content goes through the global
  FAB and New Memo panel, everywhere.
- Do not put a separate title bar under music artwork. The cover is full-bleed.

---

## 10. Breakpoints

`1024px` (sidebar becomes a drawer), `900px`, `640px`, `560px`. See ADR-009 and
`frontend/src/lib/useBreakpoint.ts`. Owner overrides inside the mobile block are
deliberate and are not to be "corrected".
