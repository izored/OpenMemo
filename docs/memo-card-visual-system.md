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

---

## Hover Behavior — Minimal cards only

Normal cards have no transform and no overlay on hover.

The `.om-min-hover` overlay fades in on card hover (opacity 0 → 1). Gradient and text color belong to the overlay layer, not the image itself.

| Type | Action buttons | Footer pill | Blur on hover | Scale on hover | Overlay · Light | Overlay · Dark | Overlay text |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `om-card-image` | ✓ | expands on hover | ✗ | ✓ | ✗ | ✗ | — |
| `om-card-link` | ✓ | always visible | ✓ | ✓ | accent tint if desc | dark veil if desc | near-black / white |
| `om-card-video` | ✓ | expands on hover | ✓ | ✓ | accent tint if desc | dark veil if desc | near-black / white |
| `om-card-audio` | ✓ | expands on hover | ✗ | ✗ | accent tint if desc | dark veil if desc | near-black / white |
| `om-card-note` | ✓ stacked | — | — | — | body text fades in | body text fades in | — |
| `om-card-doc` | ✓ | — | — | scale down 5% | — | — | — |

**Footer pill** — bottom-left pill showing source context:
- Link cards: favicon + domain name, always visible
- Image / video / audio: icon only at rest, title expands on hover
- Note / doc: not shown

**Overlay gradient** only renders when a description is present (`:has` guard). Image cards never show an overlay — clean image, scale only.

**Overlay tint** uses `color-mix(in srgb, var(--accent) 18%, transparent)` in light theme — adapts to the user's chosen accent color. Dark theme uses a black veil.

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
