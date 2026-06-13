import { useSyncExternalStore } from 'react';

// Single source of truth for the responsive breakpoints (ADR-009 / mobile plan).
// The numbers here MUST stay in sync with the `@media` blocks in openmemo.css —
// they are the one place JS reads the breakpoints; CSS reads the same literals.
//   lg  = desktop, today's rail layout  (> 1024px)
//   md  = tablet                        (641–1024px)  ┐ both are "below lg":
//   sm  = phone                         (≤ 640px)     ┘ drawer + big player
export const LG_MAX = 1024; // ≤ this width → off-canvas drawer / mobile chrome
export const SM_MAX = 640; // ≤ this width → phone single-column

const BELOW_LG = `(max-width: ${LG_MAX}px)`;
const PHONE = `(max-width: ${SM_MAX}px)`;

function makeHook(query: string) {
  const subscribe = (cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  };
  const get = () => window.matchMedia(query).matches;
  return () => useSyncExternalStore(subscribe, get, () => false);
}

// True at tablet + phone widths (anything narrower than the desktop rail layout).
// Drives the off-canvas drawer, mobile top bar, and big-player-by-default.
export const useIsMobile = makeHook(BELOW_LG);

// True only at phone widths — for single-column reflows that tablet doesn't need.
export const useIsPhone = makeHook(PHONE);
