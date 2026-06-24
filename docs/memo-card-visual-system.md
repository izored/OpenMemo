# Memo Card Visual System

A reference for how memo cards behave visually across card styles, themes, and memo types. This document reflects deliberate design decisions — not just what the code happens to do.

---

## Theme System

Two active themes driven by `data-theme` on `<html>`:

| User setting | `data-theme` on `<html>` |
|---|---|
| Light | `light` |
| Dark | `hi` |
| System → dark OS | `hi` |
| System → light OS | `light` |

All tables below use **Light** and **Dark** only.

---

## Theme Transition — Sunset / Sunrise Animation

**Decision:** Theme switches use a full-screen radial gradient overlay that animates before the UI repaints, creating a cinematic day/night transition instead of an instant color flash.

### Sequence

```
t=0ms    User clicks theme toggle
t=0ms    Overlay starts growing (radial bloom from horizon edge)
t=0ms    All UI elements begin 3s color crossfade via CSS transitions
t=100ms  data-theme attribute flips — CSS vars update underneath
t=0–6s   Overlay expands 3% → 180% radius, covers background blob layer
t=6s     Overlay at peak coverage, starts fading
t=6–12s  Overlay fades out, new theme fully revealed
t=12s    theme-transitioning class removed, background blobs fade in
```

### Overlay lives under UI (deliberate)

The overlay is `z-index: 0` — it sits behind sidebar, cards, and all interactive elements. This was a hard design decision: keeping UI always accessible and visible during the animation, at the cost of not being able to mask the UI color transition. The 3s CSS color crossfade compensates.

### Gradient colors

| Direction | Anchor | Center color | Purpose |
|---|---|---|---|
| Night falls (→ dark) | `50% 0%` top | `rgba(25, 55, 140)` midnight blue | Sky darkening from above |
| Sun rises (→ light) | `50% 100%` bottom | `rgba(255, 200, 140)` warm amber | Dawn lifting from horizon |

### CSS mechanics

- **Overlay:** `motion.div` with Framer Motion animating `--r` CSS var (radial size) + opacity
- **UI crossfade:** `.om-app.theme-transitioning *` adds `transition: background-color 3s, color 3s, border-color 3s, box-shadow 3s` scoped to the 12s transition window only
- **Blob hide:** `.om-app.theme-transitioning::before { opacity: 0 }` — blobs hidden during transition, fade in when class removes via `[data-theme="light"] .om-app::before { transition: opacity 2s }`

---

## Action Buttons — `.om-action` (open · pin · delete)

Single unified rule across all themes and card styles. No per-theme variants.

|  | Normal · Light | Normal · Dark | Minimal · Light | Minimal · Dark |
|--|:-:|:-:|:-:|:-:|
| Background | charcoal frosted | charcoal frosted | charcoal frosted | charcoal frosted |
| Icon | white | white | white | white |
| Backdrop blur | none | none | none | none |
| Size | 20 × 20 px | 20 × 20 px | 20 × 20 px | 20 × 20 px |
| Pinned state BG | accent | accent | accent | accent |

> **Note cards (minimal):** action buttons stack vertically. Note cards have a solid tinted background so charcoal + white remains readable without any override — intentional.

The edit-thumbnail pen (`.om-card-edit`) joins the cluster from below on every variant, same 4px rhythm: row cards at 34/10, minimal rows at 36/12, minimal note columns right below the open · pin · ✕ stack (top 84). One exception: the active music card's actions move to the left edge (the play cluster owns the right corner), and the pen follows them there.

---

## Hover Behavior — Minimal cards only

Normal cards have no transform and no overlay on hover.

The `.om-min-hover` overlay fades in on card hover (opacity 0 → 1). Gradient and text color belong to the overlay layer, not the image itself.

| Type | Action buttons | Footer pill | Blur on hover | Scale on hover | Overlay · Light | Overlay · Dark | Overlay text |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `om-card-image` | ✓ | expands on hover | ✗ | ✓ | ✗ | ✗ | — |
| `om-card-link` | ✓ | always visible | ✓ | ✓ | accent+white tint if desc | accent+dark tint if desc | dark / white |
| `om-card-video` | ✓ | expands on hover | ✓ | ✓ | accent+white tint if desc | accent+dark tint if desc | dark / white |
| `om-card-audio` | ✓ | expands on hover | ✗ | ✗ | accent tint if desc | dark veil if desc | near-black / white |
| `om-card-note` | ✓ stacked | — | — | — | body text fades in | body text fades in | — |
| `om-card-doc` | ✓ | — | — | scale down 5% | — | — | — |

**Footer pill** — bottom-left pill showing source context:
- Link cards: favicon + domain name, always visible
- Image / video / audio: icon only at rest, title expands on hover
- Note / doc: not shown

**Overlay gradient** only renders when a description is present (`:has` guard). Image cards never show an overlay — clean image, scale only.

**Overlay tint** is a flat frosted layer scoped to link and video cards only (the two card types with blur and description). Light theme: white base tinted with the user's accent (`color-mix(accent 30%, rgba(white,0.55))`). Dark theme: dark base tinted with the user's accent (`color-mix(accent 20%, rgba(black,0.65))`). Text is dark on light tint, white on dark tint. Readable against any thumbnail regardless of image content.

---

## What Each Memo Type Renders

| Type | Normal | Minimal |
|------|--------|---------|
| `om-card-image` | image + body (title · desc · meta) | full-bleed image · footer pill (icon → title on hover) |
| `om-card-link` | hero image + body | full-bleed hero · footer pill (favicon + domain, always visible) |
| `om-card-video` | video frame + body | full-bleed video · footer pill (icon → title on hover) |
| `om-card-audio` | audio player + body | waveform background · play button on hover · footer pill (icon → title on hover) |
| `om-card-note` | title + body + meta | title always visible · body fades in on hover |
| `om-card-doc` | doc frame + body | compact: title only · scales down slightly on hover |

> **Audio cards:** the play button in minimal is intended for inline playback within the card — no lightbox, no navigation. Full audio player feature is planned separately.

---

## Tile aspect ratios (Minimal + Edge)

Both Minimal and Edge let media keep its **real** proportions instead of forcing a
fixed shape. Image and video frames carry a `--card-ar` CSS var and a
`data-orient` attribute, set on load from the source's measured size; the frame's
`aspect-ratio` reads `var(--card-ar, <fallback>)`. So a portrait photo stays tall
and a vertical reel stays portrait, next to a wide clip.

- **One shared checker** — `frontend/src/lib/aspect.ts` (`imgAspect` / `videoAspect`
  / `aspectToOrient`) is the single source of truth for "what shape is this media?".
  Image and video cards both feed it from their thumbnail's `onLoad`. Don't assume a
  type-based default (a video is **not** always 16:9).
- **Fallbacks** apply only until the size is known: image 4/3 (portrait 3/4), video
  16/9 (portrait 9/16), audio cover 1/1.
- **Gutter** — the space between tiles is the `tweaks.gutter` slider (Appearance),
  applied to every style including Edge (0 = gapless wall). Drives the masonry gap
  in `MemoGrid`.
