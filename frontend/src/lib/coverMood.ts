import { useEffect, useState } from 'react';

// Pull a "mood" color out of a cover image so the players + the card glow can be
// tinted to match the artwork (ADR-005). Pure canvas — no dependency. Covers are
// served same-origin (`/api/files/thumb/…`, `/api/memos/:id/file`), so the canvas
// is never tainted; a remote/CORS-tainted image fails gracefully to null and the
// UI falls back to the theme tokens.

export interface CoverMood {
  /** Vivid color for the glow, as an `r,g,b` triplet (use in rgba(var(--x), a)). */
  rgb: string;
  /** Gradient top stop for the player surface (mid-dark, ~L40%). */
  base: string;
  /** Gradient bottom stop (deep, ~L22%). */
  deep: string;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
}

function extract(img: HTMLImageElement): CoverMood | null {
  const W = 24;
  const H = 24;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 128) continue;
    const cr = d[i];
    const cg = d[i + 1];
    const cb = d[i + 2];
    // Skip near-black / near-white so the mood is the artwork's actual color,
    // not the dark frame or a white border.
    const lum = (Math.max(cr, cg, cb) + Math.min(cr, cg, cb)) / 510;
    if (lum < 0.07 || lum > 0.93) continue;
    r += cr; g += cg; b += cb; n += 1;
  }
  if (n === 0) return null;
  const [h, s0] = rgbToHsl(r / n, g / n, b / n);
  // Boost saturation so the tint reads as a "mood", not muddy grey.
  const s = Math.min(1, Math.max(0.42, s0 * 1.35));
  return {
    rgb: hslToRgb(h, s, 0.5),
    base: hslToRgb(h, s, 0.4),
    deep: hslToRgb(h, s, 0.22),
  };
}

/** Extract a cover's mood color. Returns null while loading, on failure, or when
 *  `src` is absent — callers fall back to theme tokens. */
export function useCoverMood(src?: string | null): CoverMood | null {
  const [mood, setMood] = useState<CoverMood | null>(null);
  useEffect(() => {
    if (!src) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the mood when the cover src clears
      setMood(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        setMood(extract(img));
      } catch {
        setMood(null);
      }
    };
    img.onerror = () => {
      if (!cancelled) setMood(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return mood;
}
