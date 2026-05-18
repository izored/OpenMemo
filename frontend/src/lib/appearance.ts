// Appearance helpers ported from the OpenMemo design bundle (app.jsx).
// Drive theme / accent / background CSS variables on <html>.

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
  cardStyle: 'minimal' | 'hybrid' | 'rich';
  density: 'compact' | 'comfy' | 'roomy';
  typePair: 'satoshi' | 'general' | 'cabinet';
  layout: 'boxed' | 'full';
  gridColumns: number;
  bgMode: 'none' | 'random' | 'image';
  bgImage: string;
  bgFade: number;
  bgPalette: string[];
  bgPositions: [number, number][];
  customAccents: [string, string];
}

const TYPE_PAIRS: Record<string, { ui: string; display: string }> = {
  satoshi: { ui: 'Satoshi', display: 'Satoshi' },
  general: { ui: 'General Sans', display: 'General Sans' },
  cabinet: { ui: 'Satoshi', display: 'Cabinet Grotesk' },
};

// Apply the full tweak set to <html> as data attributes + CSS variables.
// `theme: 'dark'` maps to the design's high-contrast inky `data-theme="hi"`.
export function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  root.dataset.theme = t.theme === 'dark' ? 'hi' : 'light';
  root.dataset.density = 'roomy';
  root.dataset.card = t.cardStyle;
  root.dataset.layout = t.layout || 'boxed';
  root.dataset.bg = t.bgMode || 'none';
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-deep', shade(t.accent, -28));
  root.style.setProperty('--accent-soft', shade(t.accent, 28) + '20');
  root.style.setProperty('--bg-image', t.bgImage ? `url(${t.bgImage})` : 'none');
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
}

export const ACCENT_OPTIONS = ['#F4825A', '#E8D77B', '#7DB9E8', '#C3F26B', '#E8E8E8'];

export const DEFAULT_TWEAKS: Tweaks = {
  theme: 'light',
  accent: '#F4825A',
  cardStyle: 'hybrid',
  density: 'roomy',
  typePair: 'cabinet',
  layout: 'boxed',
  gridColumns: 4,
  bgMode: 'random',
  bgImage: '',
  bgFade: 0,
  bgPalette: ['#F4825A', '#E8C087', '#C76E4A'],
  bgPositions: [
    [22, 24],
    [80, 22],
    [70, 78],
    [26, 80],
  ],
  customAccents: ['', ''],
};
