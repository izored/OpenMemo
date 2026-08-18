import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

/**
 * A real anchor filling its parent, so a card behaves like a link.
 *
 * openMemo had no `<a>` anywhere: all 40 navigation points were `navigate()`
 * inside a div's `onClick`. A div is not a link, so ctrl+click, middle-click,
 * "open in new tab", "copy link address", the hover status bar and keyboard
 * focus all did nothing. The only way to open a memo was a plain left click
 * that replaced the page you were on.
 *
 * The card root cannot simply become an `<a>`: it carries the drag-and-drop
 * listeners and contains real `<button>` controls, and a button inside an
 * anchor is invalid and swallows clicks. So the anchor goes *under* the
 * controls instead, covering the card, with the buttons stacked above it.
 *
 * Notes on the two things that break if you change them:
 *
 * - `draggable={false}`, because the browser's native "drag a link to make a
 *   bookmark" hijacks the pointer and dnd-kit never sees the drag.
 * - The parent needs `position: relative`. A caller that forgets does not get a
 *   subtly wrong card, it gets a page-sized invisible link: the overlay resolves
 *   against the nearest positioned ancestor, so clicking anywhere navigates.
 *   `.om-pl-card` shipped without it and every click on the Music page opened a
 *   playlist. Reading a comment did not prevent that, so there is now a dev-time
 *   check below that names the offending element in the console.
 *
 * The accessible name is the card's title, so a screen reader reads "Blue
 * archive, link" rather than "link".
 */
export function CardLink({
  to,
  label,
  className,
  onClick,
}: {
  to: string;
  label: string;
  className?: string;
  /**
   * Side effect for the current tab, such as selecting the Space you just
   * clicked. Guard it with `isPlainClick` (lib/nav): on a ctrl+click the page
   * opens in a new tab and rearranging this one is exactly wrong.
   */
  onClick?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  // Dev only, zero cost in production. A static parent is not a style nit here,
  // it is a full-page click target, and it is invisible: nothing looks wrong
  // until you click the wrong thing. Fail loudly at the point of the mistake.
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') {
      const name = parent.className || parent.tagName.toLowerCase();
      console.error(
        `[CardLink] The parent of this link (${name}) is position: static, so the ` +
          `link overlay escapes it and covers everything up to the nearest positioned ` +
          `ancestor. Every click in that area will navigate to ${to}. ` +
          `Add "position: relative" to that class.`,
      );
    }
  }, [to]);

  return (
    <Link
      ref={ref}
      to={to}
      className={className ? `om-cardlink ${className}` : 'om-cardlink'}
      aria-label={label}
      draggable={false}
      onClick={(e) => {
        // Never preventDefault: navigation is the anchor's job, and modified
        // clicks belong entirely to the browser.
        onClick?.(e);
        // Keeps the card's own handler from firing a second navigation to the
        // same place.
        e.stopPropagation();
      }}
    />
  );
}
