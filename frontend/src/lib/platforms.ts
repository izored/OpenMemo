import type { Memo } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Platform registry — the SINGLE source of truth for "what video host is this,
// what brand glyph does it get, and how do we embed it?". Three render sites
// read from here so we never again hardcode one platform (the old code only
// ever wired YouTube):
//   • MemoCard   → brand glyph on the minimal video pill
//   • Lightbox   → inline iframe player
//   • MemoDetail → inline iframe player
//
// Robust by construction: an unknown host (or a known host whose URL we can't
// parse an id out of) returns `embed: null`, and the UI falls back to
// "open original" + "Make it local". A host with no hand-drawn glyph falls back
// to its favicon. Nothing is ever a dead end.
// ────────────────────────────────────────────────────────────────────────────

export interface PlatformMeta {
  slug: string;
  label: string;
  /** Icon brand-glyph name (see BRAND_PATHS in Icon.tsx). Absent → favicon fallback. */
  glyph?: string;
  /** Brand color utility class for the glyph (see openmemo.css `.om-brand-*`). */
  brandClass?: string;
}

type EmbedFn = (rawUrl: string, u: URL) => string | null;

interface PlatformDef extends PlatformMeta {
  /** Substrings matched against the (www-stripped, lowercased) hostname. */
  hosts: string[];
  embed?: EmbedFn;
}

// Parent domain Twitch's player requires. In the browser this is whatever host
// the app is served from (localhost in dev, the real host in Docker/prod).
function twitchParent(): string {
  try {
    return window.location.hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

const PLATFORMS: PlatformDef[] = [
  {
    slug: 'youtube',
    label: 'YouTube',
    glyph: 'youtube',
    brandClass: 'om-brand-youtube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    embed: (_raw, u) => {
      let id: string | null;
      if (u.hostname === 'youtu.be') id = u.pathname.slice(1).split('/')[0] || null;
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || null;
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] || null;
      else id = u.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : null;
    },
  },
  {
    slug: 'vimeo',
    label: 'Vimeo',
    glyph: 'vimeo',
    brandClass: 'om-brand-vimeo',
    hosts: ['vimeo.com'],
    embed: (_raw, u) => {
      // vimeo.com/{id}, vimeo.com/video/{id}, player.vimeo.com/video/{id}
      const m = u.pathname.match(/(?:\/video)?\/(\d+)/);
      return m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1` : null;
    },
  },
  {
    slug: 'instagram',
    label: 'Instagram',
    glyph: 'instagram',
    brandClass: 'om-brand-instagram',
    hosts: ['instagram.com'],
    embed: (_raw, u) => {
      // /p/{code}/, /reel/{code}/, /tv/{code}/ — embed works for all three.
      const m = u.pathname.match(/\/(p|reel|tv)\/([^/?#]+)/);
      return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed` : null;
    },
  },
  {
    slug: 'tiktok',
    label: 'TikTok',
    glyph: 'tiktok',
    brandClass: 'om-brand-tiktok',
    hosts: ['tiktok.com'],
    embed: (_raw, u) => {
      // Needs the numeric video id (only present in full /video/{id} URLs;
      // vm.tiktok.com short links don't carry it → fallback).
      const m = u.pathname.match(/\/video\/(\d+)/);
      return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null;
    },
  },
  {
    slug: 'twitter',
    label: 'X',
    glyph: 'twitterX',
    brandClass: 'om-brand-x',
    hosts: ['twitter.com', 'x.com'],
    embed: (_raw, u) => {
      const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
      return m
        ? `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&theme=dark`
        : null;
    },
  },
  {
    slug: 'facebook',
    label: 'Facebook',
    glyph: 'facebook',
    brandClass: 'om-brand-facebook',
    hosts: ['facebook.com', 'fb.com', 'fb.watch'],
    // FB's video plugin resolves the original href server-side, so we can hand
    // it the raw URL for watch links, reels, and /videos/ permalinks alike.
    embed: (raw) =>
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(raw)}&show_text=false&width=560`,
  },
  {
    slug: 'dailymotion',
    label: 'Dailymotion',
    glyph: 'dailymotion',
    brandClass: 'om-brand-dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    embed: (_raw, u) => {
      let id: string | null;
      if (u.hostname.includes('dai.ly')) id = u.pathname.slice(1).split('/')[0] || null;
      else {
        const m = u.pathname.match(/\/video\/([^/_?#]+)/);
        id = m ? m[1] : null;
      }
      return id ? `https://www.dailymotion.com/embed/video/${id}?autoplay=1` : null;
    },
  },
  {
    slug: 'streamable',
    label: 'Streamable',
    hosts: ['streamable.com'],
    embed: (_raw, u) => {
      const m = u.pathname.match(/\/(?:e\/|o\/|s\/)?([a-z0-9]+)/i);
      return m ? `https://streamable.com/e/${m[1]}` : null;
    },
  },
  {
    slug: 'twitch',
    label: 'Twitch',
    glyph: 'twitch',
    brandClass: 'om-brand-twitch',
    hosts: ['twitch.tv'],
    embed: (_raw, u) => {
      const parent = twitchParent();
      if (u.hostname.includes('clips.twitch.tv')) {
        const slug = u.pathname.slice(1).split('/')[0];
        return slug ? `https://clips.twitch.tv/embed?clip=${slug}&parent=${parent}` : null;
      }
      const vid = u.pathname.match(/\/videos\/(\d+)/);
      if (vid) return `https://player.twitch.tv/?video=${vid[1]}&parent=${parent}&autoplay=true`;
      const clip = u.pathname.match(/\/clip\/([^/?#]+)/);
      if (clip) return `https://clips.twitch.tv/embed?clip=${clip[1]}&parent=${parent}`;
      return null;
    },
  },
  // ── Glyph-only platforms (favicon would also cover these, but a crisp brand
  // glyph reads better). No reliable iframe embed → graceful open-original. ──
  {
    slug: 'threads',
    label: 'Threads',
    glyph: 'threads',
    brandClass: 'om-brand-threads',
    hosts: ['threads.net', 'threads.com'],
  },
  {
    slug: 'reddit',
    label: 'Reddit',
    glyph: 'reddit',
    brandClass: 'om-brand-reddit',
    hosts: ['reddit.com', 'redd.it'],
  },
];

/** Resolve the platform definition for a URL, or null when host is unknown. */
function defFor(url?: string | null): PlatformDef | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h))) || null;
  } catch {
    return null;
  }
}

/**
 * Brand metadata for a memo's source platform — drives the card glyph.
 * Returns null for local uploads / unknown hosts (caller falls back to favicon
 * then the generic video icon).
 */
export function platformMeta(memo: Memo): PlatformMeta | null {
  const def = defFor(memo.source_url);
  if (!def) return null;
  return { slug: def.slug, label: def.label, glyph: def.glyph, brandClass: def.brandClass };
}

/**
 * Inline-player iframe src for a remote video memo, or null when the host has
 * no embeddable player (or the URL lacks the id we need). Null → the UI offers
 * "open original" + "Make it local" instead of a dead "no preview".
 */
export function videoEmbedUrl(memo: Memo): string | null {
  const url = memo.source_url;
  if (!url) return null;
  const def = defFor(url);
  if (!def?.embed) return null;
  try {
    return def.embed(url, new URL(url));
  } catch {
    return null;
  }
}

/** True if we can play this memo somewhere (local file or a platform embed). */
export function isPlayableVideo(memo: Memo): boolean {
  return Boolean(memo.file_path || videoEmbedUrl(memo));
}
