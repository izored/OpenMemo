import type { Memo } from '@/types';

// ────────────────────────────────────────────────────────────────────────────
// Audio platform registry — the SINGLE source of truth for linked-audio hosts
// (SoundCloud, Bandcamp, Mixcloud, Audius, …). Mirrors lib/platforms.ts for
// video. Consumed by MemoDetail (live embed) + the audio card glyph. Per ADR-005
// / ADR-001: one registry, never scattered `if (host === 'soundcloud')`. Adding
// a host here lights up every audio render site at once.
//
// `embed` returns a platform WIDGET iframe src — a LIVE reference (listen at the
// source). It is NOT our player: our shared <audio> can only play a local/pulled
// file, because platform stream URLs are signed + CORS-locked (see ADR-005).
// A null embed is not a dead end — the UI falls back to Open original + Make it
// local, and once the track is pulled it plays in our player.
// ────────────────────────────────────────────────────────────────────────────

export interface AudioPlatformMeta {
  slug: string;
  label: string;
  /** Icon brand-glyph name (see BRAND_PATHS in Icon.tsx). Absent → favicon fallback. */
  glyph?: string;
  /** Brand color utility class for the glyph (see openmemo.css `.om-brand-*`). */
  brandClass?: string;
}

type AudioEmbedFn = (rawUrl: string, u: URL) => string | null;

interface AudioPlatformDef extends AudioPlatformMeta {
  /** Substrings matched against the (www-stripped, lowercased) hostname. */
  hosts: string[];
  embed?: AudioEmbedFn;
}

const AUDIO_PLATFORMS: AudioPlatformDef[] = [
  {
    slug: 'soundcloud',
    label: 'SoundCloud',
    glyph: 'soundcloud',
    brandClass: 'om-brand-soundcloud',
    hosts: ['soundcloud.com'],
    // The widget resolves any public track/set URL server-side from `url=`,
    // so the bare profile-track URL works without a numeric id.
    embed: (raw) =>
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(raw)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&visual=false`,
  },
  {
    slug: 'mixcloud',
    label: 'Mixcloud',
    glyph: 'mixcloud',
    brandClass: 'om-brand-mixcloud',
    hosts: ['mixcloud.com'],
    embed: (raw) =>
      `https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(raw)}&hide_cover=1`,
  },
  {
    slug: 'bandcamp',
    label: 'Bandcamp',
    glyph: 'bandcamp',
    brandClass: 'om-brand-bandcamp',
    hosts: ['bandcamp.com'],
    // Bandcamp's embed needs a numeric track/album id we can't get from the page
    // URL → no inline widget; graceful Open original + Make it local instead.
    embed: () => null,
  },
  {
    slug: 'audius',
    label: 'Audius',
    glyph: 'audius',
    brandClass: 'om-brand-audius',
    hosts: ['audius.co'],
    embed: () => null,
  },
  {
    slug: 'audiomack',
    label: 'Audiomack',
    hosts: ['audiomack.com'],
    embed: () => null,
  },
];

/** Resolve the audio-platform definition for a URL, or null when host is unknown. */
function defFor(url?: string | null): AudioPlatformDef | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return (
      AUDIO_PLATFORMS.find((p) =>
        p.hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h)),
      ) || null
    );
  } catch {
    return null;
  }
}

/** True when the URL is a known audio-only platform. Mirror of backend
 *  `core/extractor.is_audio_host` so frontend + backend agree on the set. */
export function isAudioHost(url?: string | null): boolean {
  return defFor(url) !== null;
}

/** Brand metadata for a linked-audio memo's source platform, or null for local
 *  uploads / unknown hosts (caller falls back to favicon, then generic icon). */
export function audioPlatformMeta(memo: Memo): AudioPlatformMeta | null {
  const def = defFor(memo.source_url);
  if (!def) return null;
  return { slug: def.slug, label: def.label, glyph: def.glyph, brandClass: def.brandClass };
}

/** Live platform-widget iframe src for a remote audio memo, or null when the
 *  host has no embeddable widget. Null → Open original + Make it local. */
export function audioEmbed(memo: Memo): string | null {
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
