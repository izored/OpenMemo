import { describe, it, expect } from 'vitest';
import type { Memo } from '@/types';
import { videoEmbedUrl, platformMeta, isPlayableVideo } from './platforms';

// Minimal memo factory — these helpers only read source_url + file_path.
function m(source_url: string | null, file_path: string | null = null): Memo {
  return { id: 'x', type: 'video', source_url, file_path } as unknown as Memo;
}

describe('videoEmbedUrl()', () => {
  // Autoplay is opt-in (detail page must NOT autoplay on load; the lightbox
  // passes { autoplay: true } because the user just clicked play).
  it('YouTube watch URL → embed (no autoplay by default)', () => {
    expect(videoEmbedUrl(m('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });
  it('YouTube watch URL → embed with autoplay when asked', () => {
    expect(videoEmbedUrl(m('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { autoplay: true })).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1',
    );
  });
  it('youtu.be short URL → embed', () => {
    expect(videoEmbedUrl(m('https://youtu.be/dQw4w9WgXcQ'))).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0',
    );
  });
  it('YouTube Shorts → embed', () => {
    expect(videoEmbedUrl(m('https://www.youtube.com/shorts/abc123XYZ'))).toBe(
      'https://www.youtube.com/embed/abc123XYZ?rel=0',
    );
  });
  it('Vimeo → player embed (autoplay only when asked)', () => {
    expect(videoEmbedUrl(m('https://vimeo.com/123456789'))).toBe(
      'https://player.vimeo.com/video/123456789',
    );
    expect(videoEmbedUrl(m('https://vimeo.com/123456789'), { autoplay: true })).toBe(
      'https://player.vimeo.com/video/123456789?autoplay=1',
    );
  });
  it("Instagram post (the user's reported URL) → embed", () => {
    expect(videoEmbedUrl(m('https://www.instagram.com/p/DZDeFeEvwBv/?hl=en'))).toBe(
      'https://www.instagram.com/p/DZDeFeEvwBv/embed',
    );
  });
  it('Instagram reel → embed', () => {
    expect(videoEmbedUrl(m('https://www.instagram.com/reel/ABC123/'))).toBe(
      'https://www.instagram.com/reel/ABC123/embed',
    );
  });
  it('TikTok video → embed', () => {
    expect(videoEmbedUrl(m('https://www.tiktok.com/@user/video/7212345678901234567'))).toBe(
      'https://www.tiktok.com/embed/v2/7212345678901234567',
    );
  });
  it('X / Twitter status → tweet embed', () => {
    expect(videoEmbedUrl(m('https://x.com/user/status/1700000000000000000'))).toBe(
      'https://platform.twitter.com/embed/Tweet.html?id=1700000000000000000&theme=dark',
    );
  });
  it('Facebook watch → video plugin with encoded href', () => {
    const e = videoEmbedUrl(m('https://fb.watch/abcDEF123/'));
    expect(e).toContain('https://www.facebook.com/plugins/video.php?href=');
    expect(e).toContain(encodeURIComponent('https://fb.watch/abcDEF123/'));
  });
  it('Dailymotion → embed', () => {
    expect(videoEmbedUrl(m('https://www.dailymotion.com/video/x8abcde'))).toBe(
      'https://www.dailymotion.com/embed/video/x8abcde',
    );
  });
  it('Streamable → embed', () => {
    expect(videoEmbedUrl(m('https://streamable.com/abc12'))).toBe('https://streamable.com/e/abc12');
  });
  it('Twitch VOD → player with parent (explicit autoplay opt-out by default)', () => {
    // window absent under vitest's node env → twitchParent() falls back to localhost.
    // Twitch's player autoplays unless told otherwise → default gets autoplay=false.
    expect(videoEmbedUrl(m('https://www.twitch.tv/videos/123456789'))).toBe(
      'https://player.twitch.tv/?video=123456789&parent=localhost&autoplay=false',
    );
    expect(videoEmbedUrl(m('https://www.twitch.tv/videos/123456789'), { autoplay: true })).toBe(
      'https://player.twitch.tv/?video=123456789&parent=localhost&autoplay=true',
    );
  });

  // ── Graceful nulls (never a dead end — UI shows open-original / make-it-local) ──
  it('Threads → no embed (glyph only)', () => {
    expect(videoEmbedUrl(m('https://www.threads.net/@user/post/ABC123'))).toBeNull();
  });
  it('unknown host → no embed', () => {
    expect(videoEmbedUrl(m('https://rumble.com/v123-title.html'))).toBeNull();
  });
  it('TikTok short link without id → no embed', () => {
    expect(videoEmbedUrl(m('https://vm.tiktok.com/ZMabc123/'))).toBeNull();
  });
  it('no source URL → no embed', () => {
    expect(videoEmbedUrl(m(null, '/files/default/clip.mp4'))).toBeNull();
  });
});

describe('platformMeta()', () => {
  it('maps known hosts to brand glyphs', () => {
    expect(platformMeta(m('https://www.instagram.com/p/X/'))?.glyph).toBe('instagram');
    expect(platformMeta(m('https://www.tiktok.com/@u/video/1'))?.glyph).toBe('tiktok');
    expect(platformMeta(m('https://www.threads.net/@u/post/X'))?.glyph).toBe('threads');
    expect(platformMeta(m('https://x.com/u/status/1'))?.glyph).toBe('twitterX');
  });
  it('returns null for unknown hosts (caller falls back to favicon)', () => {
    expect(platformMeta(m('https://example.com/clip'))).toBeNull();
    expect(platformMeta(m(null, '/files/clip.mp4'))).toBeNull();
  });
});

describe('isPlayableVideo()', () => {
  it('true for a local file', () => {
    expect(isPlayableVideo(m(null, '/files/clip.mp4'))).toBe(true);
  });
  it('true for an embeddable remote (Instagram)', () => {
    expect(isPlayableVideo(m('https://www.instagram.com/p/X/'))).toBe(true);
  });
  it('false for an embed-less remote with no local file', () => {
    expect(isPlayableVideo(m('https://rumble.com/v123.html'))).toBe(false);
  });
});
