import { useSyncExternalStore } from 'react';

/**
 * Where "back" goes, app-wide.
 *
 * React Router stamps an `idx` on every history entry it pushes, and the
 * browser hands that same entry back on pop, forward and reload. Indexing the
 * visited paths by it is therefore exact: it cannot drift the way a hand-rolled
 * stack does once the user starts using the browser's own back/forward, and it
 * survives a refresh (the entry keeps its state, our map does not — see
 * `previousPath` returning null there while `canGoBack` stays true).
 *
 * `idx > 0` means at least one in-app push happened this session, so `-1` lands
 * on the page the user actually came from. At `idx === 0` the entry is the one
 * the app was loaded into — a deep link, a reload, a fresh window — and going
 * back would leave openMemo entirely. That is what `parentPath` is for.
 */

type HistoryState = { idx?: number } | null;

const visited = new Map<number, string>();
const listeners = new Set<() => void>();
const SEP = '\u0000';

function currentIdx(): number {
  return (window.history.state as HistoryState)?.idx ?? 0;
}

// A plain string snapshot: React compares with Object.is, and strings compare
// by value, so this can be recomputed on every read without caching.
function getSnapshot(): string {
  const idx = currentIdx();
  return `${idx}${SEP}${visited.get(idx - 1) ?? ''}`;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Called once per route change (from Layout) to name the entry we are on. */
export function recordVisit(pathname: string): void {
  const idx = currentIdx();
  if (visited.get(idx) === pathname) return;
  visited.set(idx, pathname);
  listeners.forEach((l) => l());
}

export function useNavHistory(): { canGoBack: boolean; previousPath: string | null } {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => `0${SEP}`);
  const [idx, prev] = snap.split(SEP);
  return { canGoBack: Number(idx) > 0, previousPath: prev || null };
}

/**
 * The route one level up, used when there is no history to pop — a deep link
 * into a memo should still offer a way out, and "out" is the list it belongs
 * to, not wherever the browser was before openMemo.
 */
export function parentPath(pathname: string): string {
  const space = pathname.match(/^\/space\/[^/]+/);
  if (space && pathname !== space[0]) return space[0];
  if (pathname.startsWith('/music/')) return '/music';
  return '/';
}

/** Human name for a route, so the control can say where it is about to go. */
export function routeLabel(path: string): string {
  if (path === '/') return 'the dashboard';
  if (path === '/collections') return 'Collections';
  if (path === '/ask') return 'Ask Memo';
  if (path === '/settings') return 'Settings';
  if (path === '/spaces') return 'Spaces';
  if (path === '/hidden' || path.endsWith('/hidden')) return 'Hidden';
  if (path.startsWith('/collection/')) return 'the collection';
  if (path.startsWith('/memo/')) return 'the memo';
  if (path.startsWith('/music')) return 'Music';
  if (path.startsWith('/space/')) return 'the Space';
  return 'the previous page';
}
