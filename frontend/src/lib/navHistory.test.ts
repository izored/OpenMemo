import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parentPath, routeLabel } from './navHistory';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Render the hook for real — useSyncExternalStore only behaves like the app
// sees it inside a render, so a probe component beats calling the reader by
// hand. Returns what the component actually received.
function renderHook<T>(hook: () => T): T {
  let value!: T;
  const Probe = () => { value = hook(); return null; };
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(Probe)); });
  act(() => { root.unmount(); });
  return value;
}

// Fresh module per test so the visited map starts empty, the way it does in a
// newly loaded tab.
async function freshModule() {
  vi.resetModules();
  return await import('./navHistory');
}

// react-router stamps `idx` on every entry it pushes; that is the only part of
// the history state this module reads.
function goTo(idx: number, path: string, replace = false) {
  const state = { idx, key: String(idx) };
  if (replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
}

describe('parentPath', () => {
  it('sends a deep-linked memo to the dashboard', () => {
    expect(parentPath('/memo/abc')).toBe('/');
  });
  it('sends a playlist to the music library', () => {
    expect(parentPath('/music/pl-1')).toBe('/music');
  });
  it('keeps a Space sub-route inside its Space', () => {
    expect(parentPath('/space/s1/collection/c2')).toBe('/space/s1');
    expect(parentPath('/space/s1/hidden')).toBe('/space/s1');
  });
  it('does not send a Space to itself', () => {
    expect(parentPath('/space/s1')).toBe('/');
  });
});

describe('routeLabel', () => {
  it('names a Space hidden section Hidden, not the Space', () => {
    expect(routeLabel('/space/s1/hidden')).toBe('Hidden');
  });
  it('names the music library and the dashboard', () => {
    expect(routeLabel('/music')).toBe('Music');
    expect(routeLabel('/')).toBe('the dashboard');
  });
});

describe('useNavHistory', () => {
  beforeEach(() => {
    goTo(0, '/', true);
  });

  it('reports no way back on the entry the app was loaded into', async () => {
    const { recordVisit, useNavHistory } = await freshModule();
    recordVisit('/memo/abc');
    const seen = renderHook(useNavHistory);
    expect(seen.canGoBack).toBe(false);
    expect(seen.previousPath).toBe(null);
  });

  it('names the page pushed before this one', async () => {
    const { recordVisit, useNavHistory } = await freshModule();
    recordVisit('/music');
    goTo(1, '/memo/abc');
    recordVisit('/memo/abc');
    const seen = renderHook(useNavHistory);
    expect(seen.canGoBack).toBe(true);
    expect(seen.previousPath).toBe('/music');
  });

  it('follows the browser back to the earlier entry', async () => {
    const { recordVisit, useNavHistory } = await freshModule();
    recordVisit('/');
    goTo(1, '/music');
    recordVisit('/music');
    goTo(2, '/memo/abc');
    recordVisit('/memo/abc');
    // Popped back to /music: "back" must mean the dashboard again, not the memo.
    goTo(1, '/music', true);
    const seen = renderHook(useNavHistory);
    expect(seen.canGoBack).toBe(true);
    expect(seen.previousPath).toBe('/');
  });

  it('still offers a way back after a reload wiped the map', async () => {
    const { useNavHistory } = await freshModule();
    goTo(3, '/memo/abc', true);
    const seen = renderHook(useNavHistory);
    expect(seen.canGoBack).toBe(true);
    expect(seen.previousPath).toBe(null);
  });
});
