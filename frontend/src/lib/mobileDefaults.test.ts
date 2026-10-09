import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TWEAKS, MOBILE_DEFAULT_PRESET, withMobileDefaults } from './appearance';
import { presetById } from './bgPresets';

// A phone has no Appearance panel, so its look is whatever it is handed on
// first load. These pin the three promises: a phone gets Fractal Maze + minimal
// once, a desktop never does, and a choice made after that (the drawer's theme
// toggle) is not overwritten on the next load.

function fakeScreen(matches: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// Node 25 ships a `localStorage` global of its own that shadows jsdom's and
// throws without a backing file, so each test gets a plain in-memory store.
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe('withMobileDefaults', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('ships the preset the phone default names', () => {
    expect(presetById(MOBILE_DEFAULT_PRESET)).toBeDefined();
  });

  it('gives a phone Fractal Maze, its accent and theme, and minimal cards', () => {
    fakeScreen(true);
    const preset = presetById(MOBILE_DEFAULT_PRESET)!;
    const t = withMobileDefaults({ ...DEFAULT_TWEAKS, cardStyle: 'normal', bgMode: 'cloud' });
    expect(t.bgMode).toBe('image');
    expect(t.bgPreset).toBe(MOBILE_DEFAULT_PRESET);
    expect(t.accent).toBe(preset.accent);
    expect(t.theme).toBe(preset.theme);
    expect(t.cardStyle).toBe('minimal');
    expect(JSON.parse(localStorage.getItem('openmemo_tweaks')!).bgPreset).toBe(MOBILE_DEFAULT_PRESET);
  });

  it('leaves a desktop exactly as it was', () => {
    fakeScreen(false);
    const before = { ...DEFAULT_TWEAKS, bgMode: 'cloud' as const };
    expect(withMobileDefaults(before)).toBe(before);
    expect(localStorage.getItem('openmemo_tweaks')).toBeNull();
  });

  it('applies once, so a later theme toggle survives the next load', () => {
    fakeScreen(true);
    withMobileDefaults({ ...DEFAULT_TWEAKS });
    const toggled = { ...DEFAULT_TWEAKS, theme: 'light' as const };
    expect(withMobileDefaults(toggled)).toBe(toggled);
  });
});
