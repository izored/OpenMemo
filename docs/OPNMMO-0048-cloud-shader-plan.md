# OPNMMO-0048 · Cloud shader background

**Status: Shipped (2026-06-17).** Blob drift is retired. The Appearance panel offers Color / Cloud / Live / Image; the WebGPU cloud renderer (`lib/cloudShader.ts`, `components/CloudBackground.tsx`, `lib/skyPalette.ts`) paints Cloud/Live with a static-sky fallback when WebGPU is absent. Saved `bgMode: 'random'` migrates to `cloud` on load, so existing users stop seeing blobs without touching settings. The notes below are the original plan, kept for context.

Plan for replacing the "blob drift" backdrop with a noise-based cloud shader, plus a custom-background section in the Appearance panel: Color, Cloud, and a time-aware Live mode.

## Where we are today

The backdrop is pure CSS. `.om-app::before` is a fixed full-bleed pseudo-element. `applyTweaks()` in `frontend/src/lib/appearance.ts` writes `data-bg` to `<html>` and a handful of `--bg-*` vars, and the CSS in `frontend/src/styles/openmemo.css` switches the look on `[data-bg="..."]`:

- `random` — four accent-harmonious radial orbs at randomized positions, heavily blurred, drifting on the `omIridescent` keyframe. This is the "blob drift".
- `image` — a blurred wallpaper (preset or upload).
- `none` — flat base color.

Tweaks persist to `localStorage` under `openmemo_tweaks` (see `loadTweaks` in `frontend/src/stores/appStore.ts`). Every `setTweak` re-saves and re-applies. The Appearance panel (`frontend/src/components/AppearancePanel.tsx`) is a live side panel that edits tweaks directly. `blobSpeed` drives the drift animation duration.

So the whole background is declarative: pick a mode, set some vars, the CSS paints it. There is no canvas anywhere yet.

## The approach

I keep the declarative spine and add two new background modes alongside the existing three:

- **`color`** — a single flat background color. Pure CSS, zero cost. A color picker in the panel writes one var (`--bg-solid`) and `[data-bg="color"]` paints `.om-app::before` with it. This doubles as the universal fallback target.
- **`cloud`** — a WebGPU canvas painting animated noise clouds. A single full-bleed `<canvas>` mounted once in `Layout.tsx`, behind the UI (same `z-index: 0` band as `::before`), driven by a small self-contained renderer module.

`random` (blob drift) stays in the codebase for now so nobody loses their current look on upgrade, but the panel leads with Color / Cloud / Live and treats blob drift as a legacy option. The default tweak set moves to `cloud` once it is solid.

### Why a single canvas, not per-frame React

The shader runs its own `requestAnimationFrame` loop outside React. React only mounts/unmounts it and hands it the current params (palette, speed, fullness, intensity, size, time-of-day). Re-rendering React on every frame would be wasteful and fight Lenis. The renderer reads params from a ref the component updates, so changing a slider is a cheap param write, not a teardown.

### Shader structure (noise-based clouds)

WebGPU render pipeline, one full-screen triangle, a fragment shader (WGSL) that builds clouds from fractal noise:

1. **Value/gradient noise** — a hash-based 2D noise function in WGSL (cheap, no texture upload needed for a first version).
2. **fBm (fractal Brownian motion)** — sum 4–5 octaves of that noise at doubling frequency and halving amplitude. This is the "noise group" the entry asks for: stacked octaves are what give clouds their soft, billowy, multi-scale look.
3. **Domain warp** — offset the sample coordinates by another low-octave fBm so the clouds curl instead of looking like flat static.
4. **Animation** — advance a time uniform; scroll the noise field slowly and evolve a third axis so clouds form and dissolve, not just slide.
5. **Coloring** — map cloud density to a two-stop sky gradient (horizon to zenith) blended with a cloud tint, all fed from uniforms.

Uniforms map directly to the panel controls (matching the reference screenshot): `speed`, `fullness` (coverage threshold), `intensity` (contrast/opacity of the clouds), `size` (noise scale). Plus `skyTop`, `skyBottom`, `cloudColor` derived from the time-of-day palette and the active theme.

### Time-of-day ("Live")

Live derives a sky palette from the local clock, privacy-preserving per CLAUDE.md: nothing leaves the machine.

- Primary source: the browser clock plus `Intl.DateTimeFormat().resolvedOptions().timeZone` / the local UTC offset. That already tells us the user's wall-clock hour, which is all we need to pick a sky. No network, no permission prompt.
- Optional refinement: `navigator.geolocation` would let us compute true sunrise/sunset for the latitude. This is **opt-in only** and **deferred** for the first version. We will never request location silently, and we never transmit it. Until then, Live uses fixed local-hour bands.
- Palette bands map the hour to the presets in the reference (Pre-dawn, Sunrise, Morning, Midday, Afternoon, Sunset, Dusk, Night). Live interpolates between adjacent bands by the minute so the sky drifts through the day. Picking a specific band (e.g. "Sunset") pins that palette instead of tracking the clock.
- Live re-evaluates the palette on a slow timer (every few minutes) and on tab focus, so a session left open at dusk catches up.

### Graceful fallback (mandatory)

The cloud canvas only initializes when `navigator.gpu` exists and adapter/device request and pipeline build all succeed. On any failure:

1. The canvas mounts nothing (or unmounts), so there is never a blank or broken `<canvas>` on screen.
2. The background mode silently resolves to a static paint: the Color mode using the time-of-day band's sky color (so Live still gives a day-appropriate flat sky), or the user's last non-cloud background. Never blank.
3. The panel shows a small inline note that the live cloud shader needs WebGPU, with the static sky shown instead. Switching mode still works.

`prefers-reduced-motion` is honored: the shader either freezes on a single evolved frame or falls back to the static sky, so motion-sensitive users get a still cloud, not a loop.

Theme awareness: every color the shader uses comes from the time/theme palette, so the clouds read in both `[data-theme="light"]` and `[data-theme="hi"]` (dark). Dark mode gets a deep night/twilight sky rather than a washed-out daytime one.

## New tweaks

Added to the `Tweaks` model in `appearance.ts` (all optional with defaults, so existing persisted blobs migrate cleanly):

- `bgMode` gains `'color' | 'cloud' | 'live'` alongside `'none' | 'random' | 'image'`.
- `bgSolid: string` — the Color mode hex.
- `cloudSpeed`, `cloudFullness`, `cloudIntensity`, `cloudSize: number` — shader params (0..1-ish ranges matching the reference sliders).
- `skyBand: 'auto' | 'predawn' | 'sunrise' | 'morning' | 'midday' | 'afternoon' | 'sunset' | 'dusk' | 'night'` — `'auto'` is Live (track the clock); any other value pins that sky.

`applyTweaks` writes `--bg-solid` and the resolved sky vars; the canvas reads cloud params + sky from the same tweak set.

## Panel UI

A "Custom background" section restructures the existing Background row into mode tabs: **Color · Cloud · Live · Image · (Random, legacy)**.

- Color leads to a single color picker.
- Cloud leads to the four sliders (Speed, Fullness, Intensity, Size) plus a sky-band row (Pre-dawn … Night), mirroring the reference screenshot.
- Live leads to the same sky-band row with "Auto" selected, which tracks the local clock; the sliders still apply.
- Image / Random stay unchanged.

## Build order

1. Tweaks model + Color mode + panel restructure (cheap, no WebGPU). Ships a usable single-color background and the new section shape.
2. Cloud renderer module + canvas in Layout + WebGPU fallback. Ships the shader.
3. Sky palettes + Live (local-clock band interpolation). Ships time-aware clouds.

Geolocation-based true sunrise/sunset is the documented next step beyond this pass.

## What shipped vs deferred (filled in after the build)

- Shipped: Color mode, Cloud mode (WebGPU noise shader), Live mode (local-clock sky bands), full WebGPU/reduced-motion fallback to a static sky.
- Deferred: opt-in geolocation for true sunrise/sunset times (Live uses fixed local-hour bands until then).
