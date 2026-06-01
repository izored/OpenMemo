import type { Memo } from '@/types';

// Domains that use hotlink protection — proxy through backend.
export const HOTLINK_DOMAINS = ['dribbble.com', 'behance.net', 'pinterest.com', 'cdn.dribbble.com'];

// Which video platform a memo comes from — drives the brand glyph shown on the
// minimal video card. 'local' = an uploaded file (no source URL); 'video' =
// any other remote source we don't have a dedicated logo for.
export type VideoSource = 'youtube' | 'vimeo' | 'local' | 'video';

export function videoSource(memo: Memo): VideoSource {
  const url = memo.source_url;
  if (!url) return memo.file_path ? 'local' : 'video';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('vimeo.com')) return 'vimeo';
  } catch {
    /* fall through */
  }
  return memo.file_path ? 'local' : 'video';
}

export function youtubeEmbed(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname.includes('youtube.com')) id = u.searchParams.get('v');
    else if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
  } catch {
    return null;
  }
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
