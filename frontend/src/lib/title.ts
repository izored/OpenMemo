// Some sources (Facebook, TikTok, a few YouTube posts) have no real "title" —
// yt-dlp hands back the entire caption/post body as the title, so a memo can
// arrive with an 800-character "title". That reads fine as content but wrecks
// the layout when rendered as a heading.
//
// We don't throw the text away (the full caption already lives in the memo's
// description / video_description, and the untruncated title stays in the DB —
// searchable and editable). We only shorten what's shown as a HEADING, and pair
// it with a full-text tooltip so nothing is hidden.

/** Titles longer than this are treated as a caption dumped into the title. */
export const TITLE_MAX = 100;

/** True when a title is long enough to be a caption rather than a heading. */
export function isLongTitle(title: string | null | undefined, max = TITLE_MAX): boolean {
  return !!title && title.trim().length > max;
}

/**
 * A heading-length version of a title. Cuts at the last word boundary before
 * `max`, trims trailing punctuation, and appends an ellipsis. Short titles pass
 * through untouched. Always pair with `title={fullTitle}` so hover reveals all.
 */
export function truncateTitle(title: string | null | undefined, max = TITLE_MAX): string {
  const t = (title || '').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[\s.,;:!?|–—-]+$/, '');
  return `${cut}…`;
}
