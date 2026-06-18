// Appearance helpers ported from the OpenMemo design bundle (app.jsx).
// Drive theme / accent / background CSS variables on <html>.
import { presetById } from './bgPresets';
import { resolveSky, skyCss, type SkyBand } from './skyPalette';

// Perceived luminance (0..1) for choosing a readable text color on an accent.
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(x.slice(0, 2), 16) / 255;
  const g = parseInt(x.slice(2, 4), 16) / 255;
  const b = parseInt(x.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function shade(hex: string, pct: number): string {
  const h = hex.replace('#', '');
  const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(x, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + Math.round((255 * pct) / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + Math.round((255 * pct) / 100)));
  const b = Math.max(0, Math.min(255, (num & 255) + Math.round((255 * pct) / 100)));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const x = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(x.slice(0, 2), 16) / 255;
  const g = parseInt(x.slice(2, 4), 16) / 255;
  const b = parseInt(x.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hh = 0;
  let s: number;
  const l = (max + min) / 2;
  if (max === min) {
    hh = 0;
    s = 0;
  } else {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    switch (max) {
      case r: hh = (g - b) / dd + (g < b ? 6 : 0); break;
      case g: hh = (b - r) / dd + 2; break;
      case b: hh = (r - g) / dd + 4; break;
    }
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

// Contrast-safe accent for use as a FOREGROUND on the page surface (waveform
// bars, accent text/icons on a card). `--accent-text` already handles text laid
// ON the accent; this is the opposite case — the accent painted on a light or
// dark surface, where a pale green/yellow vanishes on white and a near-black
// accent vanishes on the inky dark. We nudge lightness in HSL (hue + saturation
// kept) only when the accent falls outside a legible band for the active theme,
// so well-chosen mid accents are left untouched.
export function accentInk(accent: string, dark: boolean): string {
  const [h, s, l] = hexToHsl(accent);
  const lum = luminance(accent);
  if (dark) {
    // Inky surface — lift only genuinely dark accents up to a readable band.
    if (lum >= 0.3) return accent;
    const targetL = Math.min(80, Math.max(l, 58 + (0.3 - lum) * 30));
    return hslToHex(h, s, targetL);
  }
  // Near-white surface — deepen pale/bright accents so the bars read. The paler
  // the accent, the more we darken (and bump saturation a touch so it stays the
  // same hue, not a muddy grey).
  if (lum <= 0.55) return accent;
  const targetL = Math.max(30, Math.min(l, 46 - (lum - 0.55) * 18));
  return hslToHex(h, Math.min(92, s + 6), targetL);
}

// Three colors that harmonize with the accent — analogous trio with jitter.
export function accentHarmony(accent: string): [string, string, string] {
  const [h, s, l] = hexToHsl(accent);
  const jitter = (range: number) => (Math.random() * 2 - 1) * range;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const baseS = clamp(s, 35, 85);
  return [
    hslToHex((h + jitter(8) + 360) % 360, clamp(baseS + jitter(8), 35, 85), clamp(l + jitter(6), 48, 70)),
    hslToHex((h + 22 + jitter(8) + 360) % 360, clamp(baseS * 0.8 + jitter(8), 30, 80), clamp(l + 10 + jitter(6), 55, 78)),
    hslToHex((h - 22 + jitter(8) + 360) % 360, clamp(baseS + jitter(8), 35, 85), clamp(l - 10 + jitter(6), 32, 52)),
  ];
}

// 4 [x,y] % pairs in opposing quadrants so the composition stays balanced.
export function randomBlobPositions(): [number, number][] {
  const r = (lo: number, hi: number) => Math.round(lo + Math.random() * (hi - lo));
  return [
    [r(8, 38), r(8, 38)],
    [r(62, 92), r(8, 38)],
    [r(58, 88), r(58, 90)],
    [r(12, 42), r(58, 90)],
  ];
}

export interface Tweaks {
  theme: 'light' | 'dark';
  accent: string;
  cardStyle: 'minimal' | 'normal' | 'edge';
  density: 'compact' | 'comfy' | 'roomy';
  typePair: 'satoshi' | 'general' | 'cabinet';
  layout: 'boxed' | 'full';
  gridColumns: number;
  // 'random' is the legacy "blob drift". 'color' = flat single color, 'cloud' =
  // WebGPU noise-cloud shader, 'live' = cloud shader with a clock-tracked sky
  // (OPNMMO-0048, ADR-021).
  bgMode: 'none' | 'random' | 'image' | 'color' | 'cloud' | 'live';
  bgImage: string;
  // Id of a built-in background preset (filename stem) when one is selected;
  // '' when the image is a user upload or there is none. The live URL is
  // resolved from this id at apply time so a rebuild's new hash can't stale it.
  bgPreset: string;
  bgFade: number;
  bgBlur: number;
  bgPalette: string[];
  bgPositions: [number, number][];
  customAccents: [string, string];
  blobSpeed: 0 | 2 | 4;
  // Cloud-shader background (OPNMMO-0048). bgSolid drives the flat Color mode and
  // doubles as a fallback target. Cloud params (0..1) feed the noise shader.
  // skyBand pins a sky; 'auto' tracks the local clock (Live).
  bgSolid: string;
  cloudSpeed: number;
  cloudFullness: number;
  // Intensity is no longer user-facing — frozen at 0 (the cloud renderer reads a
  // hardcoded 0). Kept on the type so saved tweaks still parse.
  cloudIntensity: number;
  cloudSize: number;
  // Optional blur over the cloud canvas (px). 0 = crisp clouds.
  cloudBlur: number;
  // Sky gradient bias (0..1): low pins the zenith color to the very top, high
  // spreads it down toward the horizon. Drives the shader + the static-sky CSS.
  skyGradient: number;
  skyBand: SkyBand;
  // Sidebar now-playing player size: 'small' = cover-thumbnail row (default),
  // 'big' = full cover on top fading into the mood color (ADR-005).
  playerSize: 'small' | 'big';
}

const TYPE_PAIRS: Record<string, { ui: string; display: string }> = {
  satoshi: { ui: 'Satoshi', display: 'Satoshi' },
  general: { ui: 'General Sans', display: 'General Sans' },
  cabinet: { ui: 'Satoshi', display: 'Cabinet Grotesk' },
};

function resolveTheme(theme: string): string {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'hi' : 'light';
  }
  return theme === 'dark' ? 'hi' : 'light';
}

// Apply the full tweak set to <html> as data attributes + CSS variables.
// `theme: 'dark'` maps to the design's high-contrast inky `data-theme="hi"`.
export function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(t.theme);
  root.dataset.density = 'roomy';
  root.dataset.card = t.cardStyle;
  root.dataset.layout = t.layout || 'boxed';
  root.dataset.bg = t.bgMode || 'none';
  root.style.setProperty('--bg-blur', `${t.bgBlur ?? 64}px`);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-deep', shade(t.accent, -28));
  root.style.setProperty('--accent-soft', shade(t.accent, 28) + '20');
  // Contrast-aware text color for anything painted on the accent (buttons,
  // chips). Pale accents get dark text so they don't disappear into white.
  root.style.setProperty('--accent-text', luminance(t.accent) > 0.62 ? '#1A1A1C' : '#FFFFFF');
  // Contrast-safe accent for foreground use on the page surface (waveform bars,
  // accent-on-card). Theme-aware so a pale accent reads on light and a dark one
  // reads on dark — see accentInk().
  root.style.setProperty('--accent-ink', accentInk(t.accent, resolveTheme(t.theme) !== 'light'));
  // A built-in preset resolves to its current bundle URL from the persisted id;
  // otherwise fall back to the (upload) URL stored directly in bgImage.
  const bgUrl = (t.bgPreset && presetById(t.bgPreset)?.url) || t.bgImage;
  root.style.setProperty('--bg-image', bgUrl ? `url(${bgUrl})` : 'none');
  const pal = Array.isArray(t.bgPalette) && t.bgPalette.length ? t.bgPalette : accentHarmony(t.accent);
  root.style.setProperty('--bg-c1', pal[0] || t.accent);
  root.style.setProperty('--bg-c2', pal[1] || shade(t.accent, 18));
  root.style.setProperty('--bg-c3', pal[2] || shade(t.accent, -18));
  const pos =
    Array.isArray(t.bgPositions) && t.bgPositions.length === 4 ? t.bgPositions : randomBlobPositions();
  pos.forEach((p, i) => {
    root.style.setProperty(`--bg-p${i + 1}x`, `${p[0]}%`);
    root.style.setProperty(`--bg-p${i + 1}y`, `${p[1]}%`);
  });
  const pair = TYPE_PAIRS[t.typePair] || TYPE_PAIRS.satoshi;
  root.style.setProperty('--font-ui', `'${pair.ui}', ui-sans-serif, system-ui`);
  root.style.setProperty('--font-display', `'${pair.display}', '${pair.ui}', ui-sans-serif, system-ui`);
  root.style.setProperty('--font-mono', `'${pair.ui}', ui-sans-serif, system-ui`);
  const speed = t.blobSpeed ?? 2;
  if (speed === 0) {
    root.style.setProperty('--blob-play-state', 'paused');
    root.style.setProperty('--blob-duration', '42s');
  } else {
    root.style.setProperty('--blob-play-state', 'running');
    root.style.setProperty('--blob-duration', `${Math.round(42 / speed)}s`);
  }
  // Cloud-shader vars (OPNMMO-0048). --bg-solid paints the flat Color mode.
  // The resolved sky also paints a static gradient that the WebGPU canvas sits
  // on TOP of — so if the shader is missing or still booting, a day-appropriate
  // sky shows instead of a blank panel (mandatory graceful fallback).
  root.style.setProperty('--bg-solid', t.bgSolid || '#0E1116');
  // Optional blur over the cloud canvas (Cloud mode only). 0 keeps clouds crisp.
  root.style.setProperty('--cloud-blur', `${t.cloudBlur ?? 0}px`);
  const sky = resolveSky(t.skyBand || 'auto', resolveTheme(t.theme) !== 'light');
  root.style.setProperty('--sky-bottom', skyCss(sky.bottom));
  root.style.setProperty('--sky-top', skyCss(sky.top));
  // Gradient bias for the static-sky fallback: map 0..1 to the top color's stop
  // position (low = top color sits near the top; high = it reaches down).
  const grad = typeof t.skyGradient === 'number' ? t.skyGradient : 0.5;
  root.style.setProperty('--sky-stop', `${Math.round(12 + (1 - grad) * 76)}%`);
}

export const ACCENT_OPTIONS = ['#F4825A', '#E8D77B', '#7DB9E8', '#C3F26B', '#71717A'];

export const DEFAULT_TWEAKS: Tweaks = {
  theme: 'light',
  accent: '#F4825A',
  cardStyle: 'normal',
  density: 'roomy',
  typePair: 'cabinet',
  layout: 'boxed',
  gridColumns: 4,
  bgMode: 'cloud',
  bgImage: '',
  bgPreset: '',
  bgFade: 0,
  bgBlur: 64,
  bgPalette: ['#F4825A', '#E8C087', '#C76E4A'],
  bgPositions: [
    [22, 24],
    [80, 22],
    [70, 78],
    [26, 80],
  ],
  customAccents: ['', ''],
  blobSpeed: 2,
  bgSolid: '#0E1116',
  cloudSpeed: 0.1,
  cloudFullness: 0.5,
  cloudIntensity: 0,
  cloudSize: 1,
  cloudBlur: 0,
  skyGradient: 0.8,
  skyBand: 'auto',
  playerSize: 'small',
};
