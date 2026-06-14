// Built-in appearance backgrounds shipped in src/assets/bg.
//
// Each file is named with its intent baked in, convention:
//   "<Color> - <Theme> - <Name> - <NN>.<ext>"
//   e.g. "Blue - Dark - Darkmist - 60.jpg" -> blue accent, dark theme, "Darkmist".
//
// Picking a preset therefore drives three things at once: the wallpaper image,
// the accent color, and the light/dark theme — so the UI always matches its
// background. The id we persist is the stable filename stem (NOT the hashed
// bundle URL, which changes every build); the live URL is resolved from the id.

// Color word in the filename -> accent hex. Where a color already exists in
// ACCENT_OPTIONS we reuse the exact value so the accent swatch lights up too.
const COLOR_ACCENT: Record<string, string> = {
  orange: '#F4825A',
  yellow: '#E8D77B',
  blue: '#7DB9E8',
  green: '#C3F26B',
  purple: '#B79CED',
  rose: '#E8889C',
};
const FALLBACK_ACCENT = '#71717A';

export interface BgPreset {
  /** Stable id = filename without extension. Persisted in tweaks.bgPreset. */
  id: string;
  /** Hashed bundle URL, resolved fresh each build. */
  url: string;
  /** Human label, e.g. "Darkmist". */
  name: string;
  /** Display color word from the filename, e.g. "Blue". */
  color: string;
  /** Accent hex this background pairs with. */
  accent: string;
  /** Theme this background is designed for. */
  theme: 'light' | 'dark';
}

// Eagerly bundle every example background. Vite returns each module's default
// export as the asset URL.
const FILES = import.meta.glob('@/assets/bg/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function parse(path: string, url: string): BgPreset {
  const file = path.split('/').pop() ?? path;
  const stem = file.replace(/\.[^.]+$/, '');
  const segs = stem
    .split('-')
    .map((s) => s.trim())
    .filter(Boolean);

  const colorWord = segs.shift() ?? '';
  const themeWord = (segs.shift() ?? '').toLowerCase();
  // Drop a trailing numeric token (the "- NN" suffix) if present.
  if (segs.length > 1 && /^\d+$/.test(segs[segs.length - 1])) segs.pop();
  const name = segs.join(' ') || titleCase(colorWord);

  const color = titleCase(colorWord);
  return {
    id: stem,
    url,
    name,
    color,
    accent: COLOR_ACCENT[colorWord.toLowerCase()] ?? FALLBACK_ACCENT,
    theme: themeWord === 'dark' ? 'dark' : 'light',
  };
}

// Dark first, then grouped by color, then name — a tidy, scannable gallery.
const THEME_ORDER: Record<string, number> = { dark: 0, light: 1 };

export const BG_PRESETS: BgPreset[] = Object.entries(FILES)
  .map(([path, url]) => parse(path, url))
  .sort(
    (a, b) =>
      (THEME_ORDER[a.theme] ?? 9) - (THEME_ORDER[b.theme] ?? 9) ||
      a.color.localeCompare(b.color) ||
      a.name.localeCompare(b.name),
  );

const BY_ID = new Map(BG_PRESETS.map((p) => [p.id, p]));

/** Look up a preset by its persisted id, or undefined if it no longer ships. */
export function presetById(id: string): BgPreset | undefined {
  return id ? BY_ID.get(id) : undefined;
}
