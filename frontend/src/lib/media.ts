import type { Memo } from '@/types';

// Domains that use hotlink protection — proxy through backend.
export const HOTLINK_DOMAINS = ['dribbble.com', 'behance.net', 'pinterest.com', 'cdn.dribbble.com'];

/**
 * Gating predicate for the "Make it local" panel.
 *
 * Returns true ONLY when ALL of the following hold:
 *   1. memo.type is a localizable media type ("video" or "audio")
 *   2. memo.source_url exists — the memo is remote, not locally uploaded
 *   3. memo.file_path is absent — no local file has been saved yet
 *   4. memo.localize_status is not "done" — the download hasn't completed
 *
 * All other memo types (article, link, image, note, document, code, file)
 * return false — "Make it local" is meaningless for non-media or local memos.
 * Use this predicate at every render site so the logic can never drift.
 */
export function canMakeLocal(memo: Memo): boolean {
  return (
    (memo.type === 'video' || memo.type === 'audio') &&
    !!memo.source_url &&
    !memo.file_path &&
    memo.localize_status !== 'done'
  );
}

// Video platform detection + embed URLs live in `lib/platforms.ts` (the single
// registry shared by MemoCard / Lightbox / MemoDetail). Audio-stream embeds
// stay here because they hang off the separate audio render path.

// Stream-embed URL for a remote audio memo (when auto-download is off and the
// track hasn't been localized). Returns a platform widget iframe src, or null
// when the host has no embeddable player (caller falls back to "open original").
export function audioEmbed(memo: Memo): string | null {
  const url = memo.source_url;
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('soundcloud.com'))
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&visual=false`;
    if (host.includes('mixcloud.com'))
      return `https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(url)}&hide_cover=1`;
    if (host.includes('bandcamp.com'))
      return null; // Bandcamp embeds need a numeric track id we don't have.
  } catch {
    /* fall through */
  }
  return null;
}

export function mediaSrc(memo: Memo): string | null {
  if (memo.thumbnail_path) {
    if (memo.thumbnail_path.startsWith('http')) {
      const needsProxy = HOTLINK_DOMAINS.some((d) => memo.thumbnail_path!.includes(d));
      if (needsProxy)
        return `/api/proxy/image?url=${encodeURIComponent(memo.thumbnail_path)}&memo_id=${memo.id}`;
    }
    return memo.thumbnail_path;
  }
  if (memo.type === 'image' && memo.file_path) return `/api/memos/${memo.id}/file`;
  return null;
}
