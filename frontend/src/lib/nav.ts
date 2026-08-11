import type React from 'react';

/**
 * Is this the plain left click that means "go there in this tab"?
 *
 * Most navigation in openMemo also changes app state on the way: selecting a
 * collection, opening a Space, closing the search overlay. Once those places
 * are real links rather than click handlers, that state change has to be
 * guarded, because ctrl+click means "open this over there and leave me where I
 * am" and rearranging the current tab is precisely not that.
 *
 * React Router's `Link` already declines modified clicks and lets the browser
 * take them, so the only thing left to guard is the side effect:
 *
 *     <Link to={`/space/${id}`} onClick={(e) => { if (isPlainClick(e)) setActiveSpace(id); }}>
 */
export function isPlainClick(e: React.MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
