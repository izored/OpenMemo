import type { Memo } from '@/types';

// Domains that use hotlink protection — proxy through backend.
export const HOTLINK_DOMAINS = ['dribbble.com', 'behance.net', 'pinterest.com', 'cdn.dribbble.com'];

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
