// Sky palettes for the cloud-shader background (OPNMMO-0048).
//
// A sky is three colors: the gradient bottom (horizon), the gradient top
// (zenith), and the cloud tint painted where noise is dense. Every color the
// shader and the static fallback use comes from here, so the backdrop reads in
// both the light and the dark `[data-theme]`.
//
// Live mode ("auto") reads the user's LOCAL clock and interpolates between
// adjacent bands by the minute, so the sky drifts through the day. This is
// privacy-preserving: it uses only `new Date()` on the user's machine, never
// geolocation and never the network. Picking a specific band pins that sky.

export type SkyBand =
  | 'auto'
  | 'predawn'
  | 'sunrise'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'sunset'
  | 'dusk'
  | 'night';

export interface Sky {
  /** Horizon color (gradient bottom). */
  bottom: [number, number, number];
  /** Zenith color (gradient top). */
  top: [number, number, number];
  /** Cloud tint where the noise field is dense. */
  cloud: [number, number, number];
}

// Bands the user can pin, in the order shown in the panel. 'auto' is Live.
export const SKY_BANDS: { id: Exclude<SkyBand, 'auto'>; label: string; hour: number }[] = [
  { id: 'predawn', label: 'Pre-dawn', hour: 4 },
  { id: 'sunrise', label: 'Sunrise', hour: 6 },
  { id: 'morning', label: 'Morning', hour: 9 },
  { id: 'midday', label: 'Midday', hour: 12 },
  { id: 'afternoon', label: 'Afternoon', hour: 15 },
  { id: 'sunset', label: 'Sunset', hour: 18 },
  { id: 'dusk', label: 'Dusk', hour: 20 },
  { id: 'night', label: 'Night', hour: 23 },
];

const rgb = (r: number, g: number, b: number): [number, number, number] => [r / 255, g / 255, b / 255];

// Light-theme skies — soft, daylit, the cloud reads as bright white/cream.
const LIGHT: Record<Exclude<SkyBand, 'auto'>, Sky> = {
  predawn:   { bottom: rgb(90, 104, 150), top: rgb(46, 54, 92),  cloud: rgb(150, 158, 196) },
  sunrise:   { bottom: rgb(255, 198, 150), top: rgb(120, 160, 210), cloud: rgb(255, 240, 224) },
  morning:   { bottom: rgb(190, 222, 248), top: rgb(96, 158, 224),  cloud: rgb(255, 255, 255) },
  midday:    { bottom: rgb(168, 210, 246), top: rgb(70, 140, 224),  cloud: rgb(255, 255, 255) },
  afternoon: { bottom: rgb(206, 224, 246), top: rgb(110, 162, 220), cloud: rgb(255, 252, 244) },
  sunset:    { bottom: rgb(255, 168, 110), top: rgb(150, 110, 180), cloud: rgb(255, 222, 200) },
  dusk:      { bottom: rgb(150, 116, 170), top: rgb(70, 70, 128),   cloud: rgb(206, 180, 206) },
  night:     { bottom: rgb(58, 72, 116),  top: rgb(24, 30, 60),     cloud: rgb(120, 132, 176) },
};

// Dark-theme skies — deeper everywhere so the inky UI stays the star and the
// clouds read as muted twilight, not a washed-out daytime sky.
const DARK: Record<Exclude<SkyBand, 'auto'>, Sky> = {
  predawn:   { bottom: rgb(40, 48, 78),  top: rgb(16, 20, 42),  cloud: rgb(78, 86, 124) },
  sunrise:   { bottom: rgb(120, 86, 78), top: rgb(40, 48, 84),  cloud: rgb(170, 128, 110) },
  morning:   { bottom: rgb(54, 80, 118), top: rgb(22, 38, 72),  cloud: rgb(120, 150, 186) },
  midday:    { bottom: rgb(50, 78, 122), top: rgb(20, 40, 80),  cloud: rgb(130, 162, 200) },
  afternoon: { bottom: rgb(58, 78, 112), top: rgb(24, 40, 72),  cloud: rgb(124, 150, 184) },
  sunset:    { bottom: rgb(120, 70, 64), top: rgb(50, 40, 78),  cloud: rgb(176, 116, 100) },
  dusk:      { bottom: rgb(64, 50, 88),  top: rgb(26, 24, 54),  cloud: rgb(112, 92, 130) },
  night:     { bottom: rgb(28, 36, 64),  top: rgb(10, 14, 34),  cloud: rgb(72, 84, 124) },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpSky(a: Sky, b: Sky, t: number): Sky {
  const mix = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    lerp(x[0], y[0], t),
    lerp(x[1], y[1], t),
    lerp(x[2], y[2], t),
  ];
  return { bottom: mix(a.bottom, b.bottom), top: mix(a.top, b.top), cloud: mix(a.cloud, b.cloud) };
}

// Local-clock hour as a float (e.g. 13.5 = 13:30), from the user's own machine.
function localHour(now = new Date()): number {
  return now.getHours() + now.getMinutes() / 60;
}

// Resolve the Live sky for the current local time, interpolating between the two
// bands the hour falls between (with wrap-around past midnight).
function autoSky(set: Record<Exclude<SkyBand, 'auto'>, Sky>, now = new Date()): Sky {
  const h = localHour(now);
  const pts = SKY_BANDS;
  // Find the two surrounding band hours, treating the day as a 24h ring.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const aH = a.hour;
    const bH = b.hour < a.hour ? b.hour + 24 : b.hour; // wrap night -> predawn
    const hh = h < aH && i === pts.length - 1 ? h + 24 : h;
    if (hh >= aH && hh <= bH) {
      const t = bH === aH ? 0 : (hh - aH) / (bH - aH);
      return lerpSky(set[a.id], set[b.id], t);
    }
  }
  // Before the first band (e.g. 02:00) -> blend night into predawn.
  const night = pts[pts.length - 1];
  const dawn = pts[0];
  const span = dawn.hour + 24 - night.hour;
  const t = (h + 24 - night.hour) / span;
  return lerpSky(set[night.id], set[dawn.id], Math.min(1, Math.max(0, t)));
}

// The one entry point: resolve a Sky from the chosen band + theme + clock.
export function resolveSky(band: SkyBand, dark: boolean, now = new Date()): Sky {
  const set = dark ? DARK : LIGHT;
  if (band === 'auto') return autoSky(set, now);
  return set[band] ?? autoSky(set, now);
}

// CSS rgb() string for a normalized [r,g,b] triplet — used by the static
// fallback and the panel preview.
export function skyCss(c: [number, number, number]): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to(c[0])}, ${to(c[1])}, ${to(c[2])})`;
}
