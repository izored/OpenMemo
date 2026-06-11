import { describe, expect, it } from 'vitest';
import { playlistShape, isPlaylistUrl } from './playlistUrl';

describe('playlistShape', () => {
  it('detects a pure YouTube playlist URL (no single item)', () => {
    const s = playlistShape('https://www.youtube.com/playlist?list=PLabc123');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: false });
  });

  it('detects a YouTube Music playlist URL', () => {
    const s = playlistShape('https://music.youtube.com/playlist?list=OLAK5uy_xyz');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: false });
  });

  it('detects watch URL with list param as both playlist and single item', () => {
    const s = playlistShape('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: true });
  });

  it('detects youtu.be short link with list param', () => {
    const s = playlistShape('https://youtu.be/dQw4w9WgXcQ?list=PLabc123');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: true });
  });

  it('ignores a plain YouTube watch URL', () => {
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
  });

  it('ignores /playlist without a list param', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist')).toBe(false);
  });

  it('detects SoundCloud sets', () => {
    const s = playlistShape('https://soundcloud.com/artist/sets/my-mix');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: false });
  });

  it('ignores a plain SoundCloud track', () => {
    expect(isPlaylistUrl('https://soundcloud.com/artist/one-track')).toBe(false);
  });

  it('detects Bandcamp albums', () => {
    const s = playlistShape('https://artist.bandcamp.com/album/the-record');
    expect(s).toEqual({ isPlaylist: true, hasSingleItem: false });
  });

  it('ignores a Bandcamp single track', () => {
    expect(isPlaylistUrl('https://artist.bandcamp.com/track/one-song')).toBe(false);
  });

  it('ignores non-playlist hosts and junk input', () => {
    expect(isPlaylistUrl('https://example.com/playlist?list=abc')).toBe(false);
    expect(isPlaylistUrl('not a url')).toBe(false);
    expect(isPlaylistUrl('')).toBe(false);
  });
});
