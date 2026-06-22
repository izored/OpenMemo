import { useSyncExternalStore } from 'react';
import type { BorderBeamColorVariant, BorderBeamSize } from 'border-beam';

// Border-beam tuning (OPNMMO-0051). Lives committed (consumers read it) while
// the gitignored dev panel at frontend/src/dev/ edits the values live. A tiny
// external store so the + button, the Ask composer AND the dev panel all stay
// in sync the instant a slider moves — a per-component useState would not.

export type BeamThemeMode = 'app' | 'auto' | 'dark' | 'light';

export interface BeamConfig {
  /** Palette preset. */
  colorVariant: BorderBeamColorVariant;
  /** 'app' = follow openMemo's light/dark; otherwise pass straight to the beam. */
  themeMode: BeamThemeMode;
  /** Size/type preset per surface (the + button is small, the composer a card). */
  islandSize: BorderBeamSize;
  composerSize: BorderBeamSize;
  /** Resting glow vs the brighter "a memo is pulling / streaming" glow. */
  ambientStrength: number;   // 0–1
  workingStrength: number;   // 0–1
  ambientBrightness: number; // multiplier
  workingBrightness: number; // multiplier
  ambientDuration: number;   // s — travel time at rest
  workingDuration: number;   // s — travel time while working
  /** Shared color shaping. */
  saturation: number;
  hueRange: number;          // deg
  staticColors: boolean;     // freeze the hue-shift
  /** Smooths the button's hover lighten so it eases instead of snapping. */
  hoverTransitionMs: number;
}

// Tuned values dialed in via the dev panel (OPNMMO-0051).
export const DEFAULT_BEAM_CONFIG: BeamConfig = {
  colorVariant: 'colorful',
  themeMode: 'app',
  islandSize: 'pulse-inner',
  composerSize: 'pulse-inner',
  ambientStrength: 0.75,
  workingStrength: 0.75,
  ambientBrightness: 1.2,
  workingBrightness: 1.75,
  ambientDuration: 6,
  workingDuration: 3,
  saturation: 3,
  hueRange: 100,
  staticColors: false,
  hoverTransitionMs: 670,
};

const LS_KEY = 'openmemo_beam_config';

function load(): BeamConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_BEAM_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_BEAM_CONFIG;
}

let state: BeamConfig = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getBeamConfig(): BeamConfig {
  return state;
}

export function setBeamConfig(patch: Partial<BeamConfig>): void {
  state = { ...state, ...patch };
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  emit();
}

export function resetBeamConfig(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  state = DEFAULT_BEAM_CONFIG;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reactive read — re-renders the consumer whenever any value changes. */
export function useBeamConfig(): BeamConfig {
  return useSyncExternalStore(subscribe, getBeamConfig, getBeamConfig);
}

/** Resolve the beam's `theme` prop from the config + the app's current theme. */
export function resolveBeamTheme(
  mode: BeamThemeMode,
  appTheme: 'light' | 'dark',
): 'light' | 'dark' | 'auto' {
  if (mode === 'app') return appTheme;
  return mode;
}
