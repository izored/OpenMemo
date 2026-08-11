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
 * - The parent needs `position: relative`. `.om-card` and the tile classes
 *   already have it; a new caller must add it or the overlay escapes to the
 *   nearest positioned ancestor and covers the page.
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
  return (
    <Link
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
