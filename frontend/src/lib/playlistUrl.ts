// Playlist-shaped URL detection (Music Experience V2, ADR-015).
//
// Cheap, client-side gate for the new-memo panel: only URLs that pass this
// check trigger the backend playlist probe (which runs yt-dlp). Mirrors
// backend/core/playlist.py `looks_like_playlist` — keep the two in sync.

export interface PlaylistShape {
  /** URL can be ingested as a whole playlist. */
  isPlaylist: boolean;
  /**
   * URL ALSO points at a single item (e.g. a YouTube watch URL with a list=
   * param). When true the panel defaults to "just this one"; when false the
   * URL is playlist-only (e.g. /playlist?list=…) and defaults to "whole playlist".
   */
  hasSingleItem: boolean;
}

export function playlistShape(raw: string): PlaylistShape {
  const none: PlaylistShape = { isPlaylist: false, hasSingleItem: false };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return none;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.toLowerCase();

  if (host.endsWith('youtube.com') || host === 'youtu.be') {
    const hasList = !!url.searchParams.get('list');
    if (path.startsWith('/playlist')) return { isPlaylist: hasList, hasSingleItem: false };
    if (hasList) {
      // watch?v=…&list=… (or youtu.be/<id>?list=…) — both readings valid.
      const hasVideo = !!url.searchParams.get('v') || (host === 'youtu.be' && path.length > 1);
      return { isPlaylist: true, hasSingleItem: hasVideo };
    }
    return none;
  }
  if (host.endsWith('soundcloud.com')) {
    return path.includes('/sets/') ? { isPlaylist: true, hasSingleItem: false } : none;
  }
  if (host.endsWith('bandcamp.com')) {
    return path.includes('/album/') ? { isPlaylist: true, hasSingleItem: false } : none;
  }
  return none;
}

/** Convenience: true when the URL can be ingested as a playlist at all. */
export function isPlaylistUrl(raw: string): boolean {
  return playlistShape(raw).isPlaylist;
}

// Spotify link detection (SpotiFLAC integration). Mirrors
// backend/core/spotiflac.py `parse_spotify_url` — keep the two in sync.
const SPOTIFY_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(track|album|playlist)[:/]([A-Za-z0-9]+)/i;

/** Returns the Spotify entity kind for a link, or null if it isn't one. */
export function spotifyKind(raw: string): 'track' | 'album' | 'playlist' | null {
  const m = SPOTIFY_RE.exec((raw || '').trim());
  return m ? (m[1].toLowerCase() as 'track' | 'album' | 'playlist') : null;
}

// Apple Music link detection (second SpotiFLAC front-end, ADR-019). Mirrors
// backend/core/apple_music.py `parse_apple_url` — keep the two in sync.
const APPLE_RE = /music\.apple\.com\/(?:[a-z]{2}\/)?(song|album|playlist)\/[^/]+\/([A-Za-z0-9.\-]+)/i;

/** Returns the Apple Music entity kind for a link, or null if it isn't one. */
export function appleKind(raw: string): 'track' | 'album' | 'playlist' | null {
  const s = (raw || '').trim();
  const m = APPLE_RE.exec(s);
  if (!m) return null;
  // ?i=<id> = a track on an album page; /song/ = a track too.
  if (/[?&]i=/.test(s) || m[1].toLowerCase() === 'song') return 'track';
  return m[1].toLowerCase() as 'album' | 'playlist';
}

/** Provider that resolves to lossless FLAC via the SpotiFLAC chain. */
export type LosslessProvider = 'spotify' | 'apple';

/** Detect the lossless provider + entity kind for a link, if any. */
export function losslessLink(
  raw: string,
): { provider: LosslessProvider; kind: 'track' | 'album' | 'playlist' } | null {
  const sk = spotifyKind(raw);
  if (sk) return { provider: 'spotify', kind: sk };
  const ak = appleKind(raw);
  if (ak) return { provider: 'apple', kind: ak };
  return null;
}
