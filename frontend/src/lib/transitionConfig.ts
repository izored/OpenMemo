import { useState } from 'react';

// Theme transition animation config. The animation in Layout.tsx reads this,
// so it stays committed (not part of the gitignored dev panel). The dev panel
// at frontend/src/dev/ only edits these values live.

export interface TransitionConfig {
  clipDuration: number;     // seconds — circle expand speed
  maxRadius: number;        // % — circle final radius
  opacityDuration: number;  // seconds — total glow lifetime
  holdPct: number;          // 0–1 — point where glow starts fading
  blur: number;             // px — blur on the glow
  themeFlipDelay: number;   // ms — when CSS vars flip (under the opaque cover)
  colorWindow: number;      // ms — how long the !important color crossfade lasts
  blobReturn: number;       // ms — legacy, unused (blobs no longer hidden)
  accentTint: number;       // % — accent color tint in the glow
  gradientSize: string;     // ellipse size, e.g. "120% 80%"
}

export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  clipDuration: 8,
  maxRadius: 110,
  opacityDuration: 5.5,
  holdPct: 0.6,
  blur: 75,
  themeFlipDelay: 200,
  colorWindow: 4250,
  blobReturn: 8000,
  accentTint: 15,
  gradientSize: '120% 80%',
};

const LS_KEY = 'openmemo_transition_config';

function load(): TransitionConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_TRANSITION_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_TRANSITION_CONFIG;
}

export function useTransitionConfig(): [TransitionConfig, (patch: Partial<TransitionConfig>) => void, () => void] {
  const [config, setConfig] = useState<TransitionConfig>(load);

  const update = (patch: Partial<TransitionConfig>) => {
    setConfig((c) => {
      const next = { ...c, ...patch };
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const reset = () => {
    localStorage.removeItem(LS_KEY);
    setConfig(DEFAULT_TRANSITION_CONFIG);
  };

  return [config, update, reset];
}
