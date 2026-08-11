import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Loader2,
  ExternalLink,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Save,
  Tag,
  Folder,
  Download,
  Maximize2,
  Expand,
  Pin,
  PinOff,
  FileText,
  Play,
  Pause,
  HardDriveDownload,
  Film,
  Music,
  Check,
  Trash2,
  AlignLeft,
  Clock,
  ListChecks,
  Captions,
  KeyRound,
  Image as ImageIcon,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BackButton } from '@/components/BackButton';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { memoApi, collectionApi } from '@/lib/api';
import { AskMemoPanel } from '@/components/AskMemoPanel';
import { BorderBeam } from 'border-beam';
import { useBeamConfig, resolveBeamTheme } from '@/lib/beamConfig';
import { useIsMobile } from '@/lib/useBreakpoint';
import { audioEmbed, audioPlatformMeta, canMakeLocal, canTranscript, canSummarize, audioKind, mediaSrc, transcriptText } from '@/lib/media';
import { videoEmbedUrl, resolveEmbedShape, platformMeta } from '@/lib/platforms';
import { useImageAspect } from '@/lib/useMediaOrientation';
import { truncateTitle, isLongTitle } from '@/lib/title';
import { useAppStore } from '@/stores/appStore';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';
import { useCoverMood } from '@/lib/coverMood';
import { Icon } from '@/components/Icon';
import { PlaylistMenu } from '@/components/PlaylistMenu';
import { Marquee } from '@/components/Marquee';
import { VolumeControl } from '@/components/VolumeControl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import type { Memo, Collection, CollectionRef, SummaryMode, GalleryItem } from '@/types';

// A signal to seek the open player (embed iframe or local <video>). The nonce
// lets the same timestamp fire repeated seeks (OPNMMO-0042).
type SeekSignal = { sec: number; nonce: number };

/** "1:02:03" / "12:34" / "1:23" → seconds. Null when it isn't a timestamp. */
function tsToSeconds(ts: string): number | null {
  const parts = ts.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Wrap mm:ss / h:mm:ss tokens in markdown links to #t=SECONDS so the custom <a>
// renderer below can turn them into clickable seek controls. Two-digit seconds
// required, so aspect ratios like "16:9" are left alone.
function linkifyTimestamps(md: string): string {
  return md.replace(/\b(\d{1,2}:[0-5]\d(?::[0-5]\d)?)\b/g, (m) => {
    const s = tsToSeconds(m);
    return s == null ? m : `[${m}](#t=${s})`;
  });
}

// Renders an AI summary as markdown (headings / bullets / bold all honored —
// OPNMMO-0042 point 5). When onSeek is given, leading timestamps become blue
// clickable controls that seek the player (point 2).
function SummaryMarkdown({ text, onSeek }: { text: string; onSeek?: (sec: number) => void }) {
  const md = onSeek ? linkifyTimestamps(text) : text;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, ...props }) => {
          if (href && href.startsWith('#t=') && onSeek) {
            const sec = Number(href.slice(3));
            return (
              <button
                type="button"
                className="om-ts-link"
                onClick={(e) => { e.preventDefault(); onSeek(sec); }}
              >
                {children}
              </button>
            );
          }
          return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
        },
      }}
    >
      {md}
    </ReactMarkdown>
  );
}

/**
 * Wraps an image or local video preview with three affordances:
 *   - Theater toggle (top-right): expands preview to full content width
 *   - Fullscreen (top-right): browser-native fullscreen API
 *   - Lightbox (click image only): modal overlay, Esc/click closes
 */
function MediaPreview({ src, alt, kind, poster, seek, theater: theaterProp, onTheaterChange }: { src: string; alt: string; kind: 'image' | 'video'; poster?: string | null; seek?: SeekSignal | null; theater?: boolean; onTheaterChange?: (v: boolean) => void }) {
  // Theater can be controlled by the page (so the layout reflows around it) or
  // self-managed when used standalone.
  const [theaterLocal, setTheaterLocal] = useState(false);
  const theater = theaterProp ?? theaterLocal;
  const setTheater = (v: boolean) => (onTheaterChange ? onTheaterChange(v) : setTheaterLocal(v));
  const [lightbox, setLightbox] = useState(false);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  // A clickable transcript/summary timestamp asks the local video to jump.
  useEffect(() => {
    if (!seek || kind !== 'video') return;
    const el = mediaRef.current as HTMLVideoElement | null;
    if (!el) return;
    try {
      el.currentTime = seek.sec;
      el.play?.().catch(() => {});
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch { /* seek best-effort */ }
  }, [seek, kind]);

  const goFullscreen = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  };

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  return (
    <>
      <div className={cn('om-media-preview', theater && 'theater')} style={{ marginBottom: '24px' }}>
        {kind === 'video' ? (
          <video
            ref={(el) => { mediaRef.current = el; }}
            src={src}
            poster={poster || undefined}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            ref={(el) => { mediaRef.current = el; }}
            src={src}
            alt={alt}
            onClick={() => setLightbox(true)}
            style={{ cursor: 'zoom-in' }}
          />
        )}
        <div className="om-media-controls">
          <button
            type="button"
            className="om-media-btn"
            onClick={() => setTheater(!theater)}
            title={theater ? 'Exit theater (compact)' : 'Theater (full width)'}
            aria-label={theater ? 'Exit theater mode' : 'Theater mode'}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="om-media-btn"
            onClick={goFullscreen}
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Expand size={14} />
          </button>
        </div>
      </div>
      {lightbox && kind === 'image' && (
        <div className="om-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(false)}>
          <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="om-lightbox-close"
            onClick={() => setLightbox(false)}
            aria-label="Close lightbox"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

// Carousel viewer for a multi-image memo (Instagram sidecar, multi-photo). Shows
// one large slide with prev/next + an "n / N" counter and a thumbnail strip;
// clicking the big image opens the shared lightbox in gallery (slide-paging)
// mode. Single-image memos never reach here (the caller checks gallery.length).
function GalleryCarousel({ gallery, alt }: { gallery: GalleryItem[]; alt: string }) {
  const [i, setI] = useState(0);
  const openGalleryLightbox = useAppStore((s) => s.openGalleryLightbox);
  const urls = gallery.map((g) => g.url);
  const n = gallery.length;
  const go = (delta: number) => setI((prev) => (prev + delta + n) % n);
  const cur = gallery[Math.min(i, n - 1)];

  return (
    <div className="om-gallery" style={{ marginBottom: '24px' }}>
      <div className="om-gallery-stage" style={{ position: 'relative' }}>
        <img
          key={cur.url}
          src={cur.url}
          alt={`${alt} — ${i + 1} of ${n}`}
          onClick={() => openGalleryLightbox(urls, i)}
          style={{ cursor: 'zoom-in', width: '100%', borderRadius: 12, display: 'block' }}
        />
        <button type="button" className="om-lightbox-nav prev" onClick={() => go(-1)} aria-label="Previous image" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}>
          <ChevronLeft size={24} />
        </button>
        <button type="button" className="om-lightbox-nav next" onClick={() => go(1)} aria-label="Next image" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
          <ChevronRight size={24} />
        </button>
        <div className="om-gallery-count" style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, padding: '3px 9px', borderRadius: 999 }}>
          {i + 1} / {n}
        </div>
      </div>
      <div className="om-gallery-thumbs" style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {gallery.map((g, idx) => (
          <button
            key={g.url + idx}
            type="button"
            onClick={() => setI(idx)}
            aria-label={`Go to image ${idx + 1}`}
            aria-current={idx === i}
            style={{
              flex: '0 0 auto', width: 56, height: 56, padding: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
              border: idx === i ? '2px solid var(--accent, #D97706)' : '2px solid transparent', opacity: idx === i ? 1 : 0.65,
            }}
          >
            <img src={g.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

// Inline platform embed for video-type memos (YouTube, Vimeo, Instagram, TikTok,
// X, …). Three shapes, driven by the platform registry (embedKind):
//   - 'video'    fixed 16/9 frame
//   - 'portrait' fixed 9/16 frame (width-capped, centered)
//   - 'card'     variable-height post (X/Twitter) — the frame auto-grows to the
//                tweet's own height (reported via postMessage) so it never clips.
// A clicked transcript/summary timestamp appends ?start= and reloads the iframe
// (keyed by the seek nonce) to seek + autoplay.
function PlatformEmbed({ memo, src, kind, aspectRatio, seek }: { memo: Memo; src: string; kind: 'video' | 'portrait' | 'card'; aspectRatio?: string; seek?: SeekSignal | null }) {
  const url = seek ? src + (src.includes('?') ? '&' : '?') + `start=${seek.sec}&autoplay=1` : src;

  // The iframe does not exist until you ask for it (ADR-025 §2).
  //
  // Mounting it on render meant that merely OPENING a memo contacted YouTube,
  // Instagram or platform.twitter.com, before anyone had pressed anything. A
  // local-first app that phones the source when you look at a saved thing is
  // not local-first, and "it is only markup" is not a defence: the request is
  // the request.
  //
  // Nothing about the look changes. The frame keeps its size and shows the
  // poster openMemo already holds on disk, with the same play affordance the
  // un-embeddable case has always used. One click and the real player takes
  // over exactly as before.
  const [armed, setArmed] = useState(false);
  // A transcript timestamp IS a play request, so it arms and seeks in one go.
  useEffect(() => {
    if (seek) setArmed(true);
  }, [seek]);
  // Card embeds (X/Twitter) report their content height to the parent via
  // postMessage. Start at a sensible height, then track the real one.
  const [cardHeight, setCardHeight] = useState(560);
  useEffect(() => {
    if (kind !== 'card' || !armed) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== 'https://platform.twitter.com') return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      const embed = (data as { ['twttr.embed']?: { method?: string; params?: { height?: number }[] } })?.['twttr.embed'];
      if (embed?.method === 'twttr.private.resize') {
        const h = embed.params?.[0]?.height;
        if (typeof h === 'number' && h > 0) setCardHeight(h);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [kind, armed]);

  // Shown until the click. Same frame, the poster we own, the same play chip.
  const facade = (label: string) => (
    <button
      type="button"
      className={cn('om-detail-poster om-embed-facade', !memo.thumbnail_path && 'no-thumb')}
      onClick={() => setArmed(true)}
      aria-label={label}
    >
      {memo.thumbnail_path && <img src={memo.thumbnail_path} alt={memo.title} />}
      <span className="om-detail-poster-play">
        <Play size={22} style={{ fill: 'currentColor' }} />
      </span>
    </button>
  );

  if (kind === 'card') {
    if (!armed) {
      return (
        <div className="om-video-embed om-video-embed--card" style={{ marginBottom: '24px' }}>
          {facade(`Load this post from ${memo.source_domain || 'the source'}`)}
        </div>
      );
    }
    return (
      <div className="om-video-embed om-video-embed--card" style={{ marginBottom: '24px' }}>
        <iframe
          key={seek?.nonce ?? 'base'}
          src={url}
          title={memo.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          scrolling="no"
          style={{ height: cardHeight }}
        />
      </div>
    );
  }

  return (
    <div
      className={`om-video-embed${kind === 'portrait' ? ' om-video-embed--portrait' : ''}`}
      style={{ marginBottom: '24px', aspectRatio: aspectRatio ?? (kind === 'portrait' ? '9/16' : '16/9') }}
    >
      {!armed ? facade(`Play from ${memo.source_domain || 'the source'}`) : (
      <iframe
        key={seek?.nonce ?? 'base'}
        src={url}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        scrolling="no"
        title={memo.title}
      />
      )}
    </div>
  );
}

// Metadata for a file-backed memo (document / code / generic file). Shared by
// the rail's Details card. These memos often have little extracted text, so the
// source file + key stats are what anchor the page.
function fileStats(memo: Memo): { ext: string; typeLabel: string; stats: { label: string; value: string }[] } {
  const ext = memo.title.includes('.') ? memo.title.split('.').pop()!.toUpperCase() : '';
  const text = memo.content_text || memo.content_raw || '';
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readMins = wordCount ? Math.max(1, Math.round(wordCount / 200)) : 0;
  const added = new Date(memo.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const typeLabel =
    ({ document: 'Document', code: 'Source file', file: 'File' } as Record<string, string>)[memo.type] || 'File';

  const stats: { label: string; value: string }[] = [
    { label: 'Added', value: added },
    { label: 'Kind', value: ext ? `${ext} · ${typeLabel}` : typeLabel },
  ];
  if (wordCount) stats.push({ label: 'Length', value: `${wordCount.toLocaleString()} words · ${readMins} min read` });
  stats.push({
    label: 'Collections',
    value: memo.collections?.length ? memo.collections.map((c) => c.name).join(', ') : 'None',
  });
  stats.push({ label: 'Tags', value: memo.tags?.length ? memo.tags.join(', ') : 'None' });
  stats.push({ label: 'AI summary', value: memo.ai_summary ? 'Generated' : 'Not yet' });
  return { ext, typeLabel, stats };
}

// Source file + metadata as a rail card — the FIRST tool for a file-backed memo
// (OPNMMO-0047). Moves the old top-of-page report block into the rail so the
// content column is the file itself; stats stack one-per-row to fit the rail.
function MetadataRailCard({ memo, open, onToggle }: { memo: Memo; open: boolean; onToggle: () => void }) {
  const { ext, typeLabel, stats } = fileStats(memo);
  return (
    <RailCard
      icon={<FileText size={16} className="om-accent-icon" />}
      title="Source file"
      open={open}
      onToggle={onToggle}
    >
      <div className="om-doc-meta">
        <div className="om-doc-meta-head">
          <div className="om-doc-report-badge">{ext ? `.${ext.toLowerCase()}` : <FileText size={20} />}</div>
          <div className="om-doc-report-headtext">
            <span className="mono om-doc-report-eyebrow">{typeLabel}</span>
            <span className="om-doc-meta-title">{memo.title}</span>
          </div>
        </div>
        <dl className="om-doc-meta-list">
          {stats.map((s) => (
            <div key={s.label} className="om-doc-meta-row">
              <dt className="mono om-doc-report-stat-label">{s.label}</dt>
              <dd className="om-doc-report-stat-value">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </RailCard>
  );
}

// Inline audio player for the detail page. Drives the SAME shared <audio> as
// the header mini-player (via the audio context), so playback continues and
// stays in sync if the user navigates away. Probes duration up-front so the
// total length shows before the first play.
function AudioMemoPlayer({ memo }: { memo: Memo }) {
  const { play, toggle, seek, isActive, playing, currentTime, duration } = useAudioPlayer();
  const src = `/api/memos/${memo.id}/file`;
  const active = isActive(memo.id);
  const [probeDur, setProbeDur] = useState(0);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = src;
    const on = () => setProbeDur(Number.isFinite(a.duration) ? a.duration : 0);
    a.addEventListener('loadedmetadata', on);
    return () => {
      a.removeEventListener('loadedmetadata', on);
      a.src = '';
    };
  }, [src]);

  const dur = active && Number.isFinite(duration) && duration > 0 ? duration : probeDur;
  const cur = active ? currentTime : 0;
  const isPlaying = active && playing;
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  const onPlay = () => {
    if (active) toggle();
    else play({
      memoId: memo.id, title: memo.title, src,
      subtitle: memo.source_domain || undefined,
      kind: audioKind(memo), cover: memo.thumbnail_path || null, pinned: memo.pinned, liked: memo.liked,
    });
  };
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * dur);
  };

  return (
    <div className="om-audio-detail" style={{ marginBottom: '20px' }}>
      {memo.thumbnail_path && (
        <img
          className="om-audio-detail-cover"
          src={memo.thumbnail_path}
          alt=""
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
      <button
        className={cn('om-audio-detail-play', isPlaying && 'playing')}
        onClick={onPlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="om-audio-detail-body">
        <div
          className="om-audio-detail-track"
          onClick={onScrub}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          tabIndex={0}
        >
          <div className="om-audio-detail-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="om-audio-detail-meta mono">
          <span>{formatTime(cur)}</span>
          <span>{dur > 0 ? formatTime(dur) : '--:--'}</span>
        </div>
      </div>
      <a
        className="om-audio-detail-dl"
        href={`/api/memos/${memo.id}/file?download=1`}
        download
        title="Download to device"
        aria-label="Download to device"
      >
        <Download size={16} />
      </a>
    </div>
  );
}

// Hero player for MUSIC memos with cover art (ADR-005/010). A large cover-forward
// "now playing" card — cover on the left, title + transport + scrubber on a
// cover-mood-tinted right panel. Drives the SAME shared <audio>. Voice memos and
// cover-less audio keep the compact AudioMemoPlayer bar.
function MusicDetailPlayer({ memo }: { memo: Memo }) {
  const { play, toggle, seek, isActive, playing, currentTime, duration, repeat, toggleRepeat } = useAudioPlayer();
  const src = `/api/memos/${memo.id}/file`;
  const active = isActive(memo.id);
  const cover = memo.thumbnail_path || null;
  const mood = useCoverMood(cover);
  const [probeDur, setProbeDur] = useState(0);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = src;
    const on = () => setProbeDur(Number.isFinite(a.duration) ? a.duration : 0);
    a.addEventListener('loadedmetadata', on);
    return () => {
      a.removeEventListener('loadedmetadata', on);
      a.src = '';
    };
  }, [src]);

  const dur = active && Number.isFinite(duration) && duration > 0 ? duration : probeDur;
  const cur = active ? currentTime : 0;
  const isPlaying = active && playing;
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;

  const onPlay = () => {
    if (active) toggle();
    else play({
      memoId: memo.id, title: memo.title, src,
      subtitle: memo.audio_artist || memo.source_domain || undefined,
      album: memo.audio_album || undefined,
      kind: audioKind(memo), cover, pinned: memo.pinned, liked: memo.liked,
    });
  };
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || dur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * dur);
  };

  // Cover width by artwork shape: a 16:9 YouTube/video thumbnail gets a wide
  // panel (80%); square music art (uploaded file, SoundCloud) gets 40%. Measured
  // from the image so it works regardless of source. Drives --cover-w (ADR-010).
  // Hold the player hidden until the cover has loaded + its aspect is known, then
  // fade the whole thing in at once — so the width settles (40↔80) while invisible
  // and nothing pops in piecemeal on load (ADR-010).
  const [coverWide, setCoverWide] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derive cover aspect from the image load (external system)
    if (!cover) { setCoverWide(null); setReady(true); return; }
    setReady(false);
    const img = new Image();
    img.onload = () => { setCoverWide(img.naturalWidth / img.naturalHeight > 1.3); setReady(true); };
    img.onerror = () => { setCoverWide(null); setReady(true); };
    img.src = cover;
  }, [cover]);

  const heroStyle = {
    ...(mood ? { ['--cov-base']: mood.base, ['--cov-deep']: mood.deep } : {}),
    ...(coverWide == null ? {} : { ['--cover-w']: coverWide ? '80%' : '40%' }),
    opacity: ready ? 1 : 0,
  } as React.CSSProperties;

  return (
    <div className={cn('om-music-detail', mood && 'is-tinted')} style={heroStyle}>
      <div className="om-music-detail-bg" style={{ backgroundImage: `url(${cover})` }} aria-hidden />
      <div className="om-music-detail-veil" aria-hidden />
      <div className="om-music-detail-body">
        <div className="om-music-detail-head">
          <Marquee className="om-music-detail-title" text={memo.title} auto={active} />
          {/* Real artist from file tags only — never the source domain (ADR-010). */}
          {memo.audio_artist && <span className="om-music-detail-artist">{memo.audio_artist}</span>}
        </div>
        <div className="om-music-detail-controls">
          <button
            className={cn('om-music-detail-btn', repeat && 'active')}
            onClick={toggleRepeat}
            title={repeat ? 'Repeat one: on' : 'Repeat one: off'}
            aria-pressed={repeat}
            aria-label="Repeat one"
          >
            <Icon name={repeat ? 'repeat1' : 'repeat'} size={18} />
          </button>
          <button
            className={cn('om-music-detail-play', isPlaying && 'playing')}
            onClick={onPlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={24} stroke={0} style={{ fill: 'currentColor', marginLeft: isPlaying ? 0 : 2 }} />
          </button>
          <VolumeControl className="om-music-detail-vol" size={18} />
        </div>
        <div className="om-music-detail-scrub">
          <span className="om-music-detail-time mono">{formatTime(cur)}</span>
          <div
            className="om-music-detail-track"
            onClick={onScrub}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            tabIndex={0}
          >
            <div className="om-music-detail-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="om-music-detail-time mono">{dur > 0 ? formatTime(dur) : '--:--'}</span>
        </div>
      </div>
    </div>
  );
}

// Transcript block, rendered directly under the audio player. Shows the cleaned
// speech-to-text result, a live "transcribing…" state, or an on-demand
// Transcribe button for audio that was uploaded (rather than recorded).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for reference; superseded by the tool rail (OPNMMO-0042), may return
function AudioTranscript({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [open, setOpen] = useState(false);
  const status = memo.transcript_status;
  const text = transcriptText(memo) || '';
  const pending = status === 'pending' || status === 'processing' || starting;

  const startTranscribe = async () => {
    setStarting(true);
    try {
      await memoApi.transcribe(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="om-transcript" style={{ marginBottom: '24px' }}>
      <button
        className="om-extracted-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{ marginBottom: open ? '10px' : 0 }}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        <FileText size={14} />
        Transcript
        {memo.transcript_lang && (
          <span className="om-tag" style={{ textTransform: 'uppercase', marginLeft: 4 }}>{memo.transcript_lang}</span>
        )}
        {pending && <Loader2 size={14} className="om-spin" style={{ marginLeft: 4 }} />}
      </button>

      {open && (
        pending ? (
          <p className="om-detail-desc">Transcribing audio… this runs locally and may take a moment.</p>
        ) : text ? (
          <div className="om-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || text}</ReactMarkdown>
          </div>
        ) : status === 'error' ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>
              Transcription failed. Check that the speech-to-text model is installed on the server.
            </p>
            <button className="om-btn-ghost om-btn-pill" onClick={startTranscribe} disabled={starting}>
              <Sparkles size={14} /> Try again
            </button>
          </div>
        ) : (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>No transcript yet.</p>
            <button className="om-btn-primary om-btn-pill" onClick={startTranscribe} disabled={starting}>
              {starting ? <Loader2 size={14} className="om-spin" /> : <Sparkles size={14} />}
              Transcribe
            </button>
          </div>
        )
      )}
    </div>
  );
}

// Collapsible original-source description for MUSIC memos (ADR-010). A song has
// no transcript (that's lyrics, deferred), but a linked/localized track often
// carries a rich description from its source (YouTube/SoundCloud) that defines
// the content — tracklist, timestamps, notes. Keep it, clearly labeled
// "Description" (NOT transcript), togglable below the hero player.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for reference; superseded by the tool rail (OPNMMO-0042), may return
function MusicDescription({ memo }: { memo: Memo }) {
  const [open, setOpen] = useState(false);
  const text = memo.video_description || memo.content_text || '';
  if (!text.trim()) return null;
  return (
    <div className="om-transcript" style={{ marginBottom: '24px' }}>
      <button
        className="om-extracted-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{ marginBottom: open ? '10px' : 0 }}
      >
        <ChevronDown size={16} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s ease' }} />
        <FileText size={14} />
        Description
      </button>
      {open && (
        <div className="om-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// Two-tab panel for video memos sourced from YouTube/social platforms.
// "Video description" = platform metadata. "Transcript" = Whisper STT result.
// Fixes the bug where content_text (YouTube description) was mislabeled "Transcript".
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for reference; superseded by the tool rail (OPNMMO-0042), may return
function VideoContentPanel({ memo }: { memo: Memo }) {
  const queryClient = useQueryClient();
  // Collapsed by default (null): the two buttons are toggles, so a long video
  // page no longer dumps the whole description + transcript inline on load.
  // Clicking a tab opens it; clicking the open tab again closes it (OPNMMO-0042).
  const [tab, setTab] = useState<'description' | 'transcript' | null>(null);
  const [starting, setStarting] = useState(false);
  const status = memo.transcript_status;
  const pending = status === 'pending' || status === 'processing' || starting;
  const descText = memo.video_description || memo.description || '';

  const startTranscribe = async () => {
    setStarting(true);
    try {
      await memoApi.transcribe(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  if (!descText && !status && !canTranscript(memo)) return null;

  const srcLabel = memo.transcript_source === 'captions' ? 'CC' : memo.transcript_source === 'stt' ? 'STT' : null;

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button
          className={cn('om-tab-btn', tab === 'description' && 'active')}
          onClick={() => setTab((t) => (t === 'description' ? null : 'description'))}
          aria-expanded={tab === 'description'}
        >
          {tab === 'description' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <AlignLeft size={13} />
          Video description
        </button>
        <button
          className={cn('om-tab-btn', tab === 'transcript' && 'active')}
          onClick={() => setTab((t) => (t === 'transcript' ? null : 'transcript'))}
          aria-expanded={tab === 'transcript'}
        >
          {tab === 'transcript' ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <FileText size={13} />
          Transcript
          {pending && <Loader2 size={12} className="om-spin" style={{ marginLeft: 4 }} />}
        </button>
      </div>

      {tab === 'description' && (
        descText ? (
          <p className="om-detail-desc" style={{ whiteSpace: 'pre-wrap' }}>{descText}</p>
        ) : (
          <p className="om-detail-desc" style={{ fontStyle: 'italic' }}>No description available.</p>
        )
      )}

      {tab === 'transcript' && (
        pending ? (
          <p className="om-detail-desc">
            <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
            Pulling captions or transcribing… runs locally and may take a moment.
          </p>
        ) : transcriptText(memo) ? (
          <div className="om-prose" style={{ whiteSpace: 'pre-wrap' }}>
            {/* Source/lang tags live inline at the head of the transcript, not
                as chips on the toggle button (OPNMMO-0042). */}
            {(srcLabel || memo.transcript_lang) && (
              <p className="om-transcript-tags" style={{ whiteSpace: 'normal' }}>
                {srcLabel && (
                  <span className="om-tag" title={memo.transcript_source === 'captions' ? 'From source captions' : 'Whisper speech-to-text'}>{srcLabel}</span>
                )}
                {memo.transcript_lang && (
                  <span className="om-tag" style={{ textTransform: 'uppercase' }}>{memo.transcript_lang}</span>
                )}
              </p>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{transcriptText(memo)!}</ReactMarkdown>
          </div>
        ) : status === 'error' || status === 'done' ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>
              Couldn’t get a transcript. The source may have no captions and no downloadable audio, or be private/region-locked.
            </p>
            {canTranscript(memo) && (
              <button className="om-btn-ghost om-btn-pill" onClick={startTranscribe} disabled={starting}>
                <Captions size={14} /> Try again
              </button>
            )}
          </div>
        ) : canTranscript(memo) ? (
          <div>
            <p className="om-detail-desc" style={{ marginBottom: 10 }}>
              No transcript yet. Pull the source’s captions (or transcribe with Whisper) — the video stays put.
            </p>
            <button className="om-btn-primary om-btn-pill" onClick={startTranscribe} disabled={starting}>
              {starting ? <Loader2 size={14} className="om-spin" /> : <Captions size={14} />}
              Get transcript
            </button>
          </div>
        ) : (
          <p className="om-detail-desc">No transcript available for this memo.</p>
        )
      )}
    </div>
  );
}

// Remote audio: stream it inline via the platform's embed widget
// (SoundCloud/Mixcloud), with options to open the original or save a local copy
// for offline + transcription. `reference` = the memo already has a local file,
// so this is just a "listen at the source" reference — hide the Save action.
function AudioStreamEmbed({ memo, reference = false }: { memo: Memo; reference?: boolean }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  // Always starts collapsed, and the iframe below only exists while it is open,
  // so opening a memo never contacts SoundCloud, Bandcamp or YouTube (ADR-025
  // §2). Audio follows the same rule as video: the source is reached when you
  // ask for it, not when you look at the memo.
  //
  // `reference` (the track is already local, so this widget is only a pointer
  // back to where it came from) no longer changes the initial state, because
  // the initial state is now collapsed either way. It stays a prop because the
  // heading copy still uses it.
  const [collapsed, setCollapsed] = useState(true);
  const embed = audioEmbed(memo);
  const meta = audioPlatformMeta(memo);
  const sourceName = meta?.label || memo.source_domain || 'the source';

  const save = async () => {
    setSaving(true);
    try {
      await memoApi.localize(memo.id, 'audio');
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      alert((e as Error).message || 'Failed to start download');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom: '24px' }}>
      {/* Click the heading to hide/show the live source widget. */}
      <button
        className="om-music-source-head"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show source player' : 'Hide source player'}
      >
        <ChevronDown
          size={16}
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s ease' }}
        />
        {meta?.glyph ? (
          <Icon name={meta.glyph} size={16} className={meta.brandClass} />
        ) : (
          <Icon name="music" size={16} />
        )}
        <span>{reference ? `Listen on ${sourceName}` : `Play on ${sourceName}`}</span>
      </button>
      {!collapsed && (
        <>
          {embed ? (
            <iframe className="om-audio-embed" src={embed} title={memo.title} allow="autoplay" loading="lazy" />
          ) : (
            <div className="om-audio-embed-fallback">
              {memo.thumbnail_path && (
                <img src={memo.thumbnail_path} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              )}
              <p className="om-detail-desc">
                No inline player for {memo.source_domain || 'this source'}. Open the original (link above) or save a local copy.
              </p>
            </div>
          )}
          {/* "Open original" removed — the source link at the top of the page
              already covers it. Only the save-local action remains. */}
          {!reference && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="om-btn-primary om-btn-pill" onClick={save} disabled={saving}>
                {saving ? <Loader2 size={14} className="om-spin" /> : <HardDriveDownload size={14} />} Save audio in openMemo
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// "Make it local" — download a remote video/audio source via yt-dlp so the memo
// survives the original being deleted/privated. Offers three modes; polls
// localize_status (driven by the page's refetchInterval) and shows progress.
function MakeItLocalPanel({ memo, open, onToggle }: { memo: Memo; open?: boolean; onToggle?: () => void }) {
  const queryClient = useQueryClient();
  // Audio-only sources (SoundCloud, Bandcamp, etc.) have no video track — only
  // offer the audio download. Video sources keep both options.
  const isAudio = memo.type === 'audio';
  const [mode, setMode] = useState<'video' | 'audio'>(isAudio ? 'audio' : 'video');
  // Video height cap (OPNMMO-0022). 1080 default; 4K is an explicit pick.
  const [quality, setQuality] = useState(1080);
  const [starting, setStarting] = useState(false);
  const status = memo.localize_status;
  const busy = status === 'pending' || status === 'processing' || starting;
  const openGuide = useAppStore((s) => s.openGuide);

  // Tell a sign-in / age gate (cookies fix it) apart from a region-lock or an
  // unsupported source. yt-dlp's message is the signal.
  const providerLabel = platformMeta(memo)?.label || memo.source_domain || 'this source';
  const err = (memo.localize_error || '').toLowerCase();
  const looksGated = /age|sign[ -]?in|log[ -]?in|confirm your age|private|members?|account|cookie|\b18\b|inappropriate|consent|restricted/.test(err);

  const start = async () => {
    setStarting(true);
    try {
      await memoApi.localize(memo.id, mode, quality);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
      alert((e as Error).message || 'Failed to start download');
    } finally {
      setStarting(false);
    }
  };

  const modes: { id: typeof mode; label: string; icon: React.ElementType; hint: string }[] = isAudio
    ? [{ id: 'audio', label: 'Save audio', icon: Music, hint: 'Download the audio track' }]
    : [
        { id: 'video', label: 'Video', icon: Film, hint: 'Download the video at the quality you pick below' },
        { id: 'audio', label: 'Audio only', icon: Music, hint: 'Convert to an audio-only copy (podcast) — replaces the video view' },
      ];

  const qualities: { value: number; label: string; hint: string }[] = [
    { value: 720, label: '720p', hint: 'Smallest file' },
    { value: 1080, label: '1080p', hint: 'Default — sharp and reasonably sized' },
    { value: 1440, label: '1440p', hint: 'Big file' },
    { value: 2160, label: '4K', hint: 'Source max — very large file' },
  ];

  const body = (
    <>
      {busy ? (
        <p className="om-detail-desc">
          <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
          Downloading from {memo.source_domain || 'source'}… this can take a while for long videos.
        </p>
      ) : status === 'error' ? (
        <div>
          <p className="om-detail-desc" style={{ marginBottom: 6 }}>
            {looksGated
              ? `This ${providerLabel} video is locked behind a sign-in, often because it is age-restricted. openMemo needs your cookies to fetch it.`
              : 'Download failed. The source may be private, region-locked, or unsupported by yt-dlp.'}
          </p>
          <p className="om-detail-desc" style={{ marginBottom: 12, color: 'var(--text-3)' }}>
            Do you really want this one saved? A couple of one-time steps will unlock it.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="om-btn-primary om-btn-pill" onClick={() => openGuide('yt-cookies')}>
              <KeyRound size={14} /> Follow these steps
            </button>
            <button className="om-btn-ghost om-btn-pill" onClick={start}>
              <HardDriveDownload size={14} /> Try again
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="om-detail-desc" style={{ marginBottom: 12 }}>
            Save a copy to OpenMemo so it keeps working even if the original is taken down.
          </p>
          <div className="om-localize-modes">
            {modes.map((m) => (
              <button
                key={m.id}
                className={cn('om-localize-mode', mode === m.id && 'active')}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                <m.icon size={15} />
                <span>{m.label}</span>
                {mode === m.id && <Check size={13} className="om-localize-check" />}
              </button>
            ))}
          </div>
          {!isAudio && mode === 'video' && (
            <div className="om-localize-modes" style={{ marginTop: 8 }}>
              {qualities.map((q) => (
                <button
                  key={q.value}
                  className={cn('om-localize-mode', quality === q.value && 'active')}
                  onClick={() => setQuality(q.value)}
                  title={q.hint}
                >
                  <span>{q.label}</span>
                  {quality === q.value && <Check size={13} className="om-localize-check" />}
                </button>
              ))}
            </div>
          )}
          {!isAudio && mode === 'video' && quality > 1080 && (
            <p className="om-detail-desc" style={{ marginTop: 10, fontStyle: 'italic' }}>
              {quality === 2160 ? '4K' : '1440p'} downloads can be several gigabytes and most hosts serve them as VP9/AV1 — playback works in modern browsers, but the file is much heavier. If the source has no {quality === 2160 ? '4K' : '1440p'} stream, the best available below it is saved.
            </p>
          )}
          {!isAudio && mode === 'audio' && (
            <p className="om-detail-desc" style={{ marginTop: 10, fontStyle: 'italic' }}>
              Heads up: this turns the memo into an audio-only copy and replaces the video player. Want a transcript instead? Use <strong>Get transcript</strong> below — it keeps the video.
            </p>
          )}
          <button className="om-btn-primary om-btn-pill" onClick={start} style={{ marginTop: 12 }}>
            <HardDriveDownload size={14} /> Save {mode === 'audio' ? 'audio' : 'video'} in openMemo
          </button>
        </>
      )}
    </>
  );

  // In the rail: part of the accordion (one card open at a time). Internal state
  // changes (picking quality, a download in flight) live in the body and never
  // toggle the card; opening another tool closes this one.
  if (onToggle) {
    return (
      <RailCard
        icon={<HardDriveDownload size={16} className="om-accent-icon" />}
        title="Make it local"
        done={status === 'done'}
        open={open}
        onToggle={onToggle}
      >
        {body}
      </RailCard>
    );
  }

  // Standalone (e.g. inline in the audio block): full self-contained card.
  return (
    <div className="om-localize" style={{ marginBottom: '24px' }}>
      <div className="om-ai-summary-head" style={{ marginBottom: '10px' }}>
        <HardDriveDownload size={16} className="om-accent-icon" />
        <h3 className="om-rail-title">Make it local</h3>
        {status === 'done' && <span className="om-tag" style={{ color: 'var(--accent)' }}>Saved locally</span>}
      </div>
      {body}
    </div>
  );
}

// On-demand AI summary with three modes (Timestamp / Key Insights / Essay).
// Each mode is a separate Ollama call fed the full content/transcript; results
// are cached per-mode on the memo so switching back is instant. Timestamp mode
// is offered only for video/audio (it relies on inline [mm:ss] transcript marks).
const SUMMARY_OPTIONS: { id: SummaryMode; label: string; icon: React.ElementType }[] = [
  { id: 'timestamp', label: 'Timestamp', icon: Clock },
  { id: 'insights', label: 'Key Insights', icon: ListChecks },
  { id: 'essay', label: 'Essay', icon: AlignLeft },
];

function SummaryPanel({
  memo,
  onSeek,
  open,
  onToggle,
}: {
  memo: Memo;
  onSeek?: (sec: number) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const chatModel = useAppStore((s) => s.chatModel);
  const isMedia = memo.type === 'video' || memo.type === 'audio';
  const options = isMedia ? SUMMARY_OPTIONS : SUMMARY_OPTIONS.filter((o) => o.id !== 'timestamp');
  const [mode, setMode] = useState<SummaryMode>('insights');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Backend may answer "I started pulling the transcript first" (OPNMMO-0042).
  // We then wait on the memo poll and auto-retry once the transcript settles.
  const [waitingTranscript, setWaitingTranscript] = useState(false);
  const autoRetried = useRef(false);
  const summaries = memo.summaries || {};
  const current = summaries[mode] ?? (mode === 'insights' ? memo.ai_summary : undefined);
  const label = (options.find((o) => o.id === mode)?.label || 'summary').toLowerCase();

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await memoApi.summary(memo.id, mode, chatModel || undefined);
      // No transcript yet for a video/audio memo: the backend kicked one off in
      // the background. Park in a waiting state; the auto-retry effect fires the
      // real summary once transcript_status flips to done (or error → desc-only).
      if (res?.status === 'transcript_pending') {
        autoRetried.current = false;
        setWaitingTranscript(true);
        queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
        return;
      }
      setWaitingTranscript(false);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      // The backend sends human-readable details (model missing, Ollama down,
      // timeout) — show them instead of failing silently into the console.
      setWaitingTranscript(false);
      setError(e instanceof Error ? e.message : 'Summary generation failed');
    } finally {
      setBusy(false);
    }
  }, [memo.id, mode, chatModel, queryClient]);

  // While waiting on a background transcript, retry the summary exactly once the
  // memo poll reports the transcript settled. 'done' → summarize desc+transcript;
  // 'error' → backend falls back to the description alone (no transcript loop).
  useEffect(() => {
    if (!waitingTranscript || autoRetried.current) return;
    const st = memo.transcript_status;
    if (st === 'done' || st === 'error') {
      autoRetried.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot auto-retry once the background transcript settles
      generate();
    }
  }, [waitingTranscript, memo.transcript_status, generate]);

  const hasSummary = !!memo.ai_summary || Object.values(memo.summaries || {}).some(Boolean);

  return (
    <section className="om-rail-card">
      <button className="om-rail-head" onClick={onToggle} aria-expanded={open}>
        <Sparkles size={16} className="om-accent-icon" />
        <span className="om-rail-title">AI Summary</span>
        {hasSummary && <Check size={14} className="om-rail-check" />}
        <motion.span className="om-rail-head-chev" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}>
          <ChevronDown size={16} />
        </motion.span>
      </button>
      <RailCollapse open={open}>
        <div className="om-rail-card-body">
          <div className="om-localize-modes" style={{ marginBottom: 12 }}>
            {options.map((o) => (
              <button
                key={o.id}
                className={cn('om-localize-mode', mode === o.id && 'active')}
                onClick={() => setMode(o.id)}
              >
                <o.icon size={15} />
                <span>{o.label}</span>
                {mode === o.id && <Check size={13} className="om-localize-check" />}
              </button>
            ))}
          </div>
          {error && !busy && (
            <p className="om-detail-desc" role="alert" style={{ color: 'var(--om-danger, #e5484d)', marginBottom: 10 }}>
              {error}
            </p>
          )}
          {busy ? (
            <p className="om-detail-desc">
              <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
              Generating {label} summary with Ollama…
            </p>
          ) : waitingTranscript ? (
            <p className="om-detail-desc">
              <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
              Fetching the transcript first — it runs locally and may take a moment. The {label} summary follows automatically.
            </p>
          ) : current ? (
            <>
              <div className="om-prose" style={{ whiteSpace: mode === 'timestamp' ? 'pre-wrap' : undefined }}>
                <SummaryMarkdown text={current} onSeek={onSeek} />
              </div>
              <button className="om-btn-ghost om-btn-pill" onClick={generate} style={{ marginTop: 12 }}>
                <Sparkles size={14} /> Regenerate
              </button>
            </>
          ) : (
            <button className="om-btn-primary om-btn-pill" onClick={generate}>
              <Sparkles size={14} /> Generate {label}
            </button>
          )}
        </div>
      </RailCollapse>
    </section>
  );
}

// Plain description text with URLs rendered as blue, underlined, NON-clickable
// spans (OPNMMO-0042 point 4). Links are inert by design — hover shows the full
// URL to copy, but nothing navigates (safer for untrusted source blurbs).
function DescriptionText({ text, onSeek }: { text: string; onSeek?: (sec: number) => void }) {
  // Split on URLs (inert) and chapter timestamps (clickable seek). URLs win when
  // they overlap, since the URL pattern is greedy and consumes any digits/colons
  // inside a link path (OPNMMO-0042).
  const parts = text.split(/(https?:\/\/[^\s]+|\b\d{1,2}:[0-5]\d(?::[0-5]\d)?\b)/g);
  return (
    <p className="om-detail-desc" style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) {
          return (
            <span key={i} className="om-desc-link" aria-label="Not clickable for safety. Select the URL and paste it into your browser.">{p}</span>
          );
        }
        const sec = /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/.test(p) ? tsToSeconds(p) : null;
        if (sec != null && onSeek) {
          return (
            <button key={i} type="button" className="om-ts-link" onClick={(e) => { e.preventDefault(); onSeek(sec); }}>{p}</button>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </p>
  );
}

// Smooth height collapse for a rail card body (framer-motion). Mounts/unmounts
// the body with an animated 0↔auto height + fade so opening/closing a section
// glides instead of snapping. overflow:hidden contains the body's top margin so
// it collapses with the height.
function RailCollapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: 0.28, ease: [0.25, 1, 0.5, 1] }, opacity: { duration: 0.2 } }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Generic collapsible rail card — shared shell + a green status check when the
// thing it holds has been achieved (OPNMMO-0042). All rail tools feel the same.
// `open`/`onToggle` make a card part of the rail accordion (one open at a time).
// Omit them and the card self-manages (independent of the accordion) — used by
// Make it local, whose own states must not hide or be hidden by siblings.
function RailCard({
  icon,
  title,
  done = false,
  badge,
  defaultOpen = false,
  open: openProp,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  done?: boolean;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const controlled = onToggle !== undefined;
  const open = controlled ? !!openProp : openLocal;
  const toggle = () => (controlled ? onToggle!() : setOpenLocal((o) => !o));
  return (
    <section className="om-rail-card">
      <button className="om-rail-head" onClick={toggle} aria-expanded={open}>
        {icon}
        <span className="om-rail-title">{title}</span>
        {done && <Check size={14} className="om-rail-check" />}
        {badge}
        <motion.span className="om-rail-head-chev" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}>
          <ChevronDown size={16} />
        </motion.span>
      </button>
      <RailCollapse open={open}>
        <div className="om-rail-card-body">{children}</div>
      </RailCollapse>
    </section>
  );
}

// Source description as a rail card (video_description / source blurb). Links
// render as inert blue text (OPNMMO-0042 point 4).
function DescriptionCard({ memo, open, onToggle, onSeek }: { memo: Memo; open: boolean; onToggle: () => void; onSeek?: (sec: number) => void }) {
  const text = (memo.video_description || memo.description || '').trim();
  return (
    <RailCard
      icon={<AlignLeft size={16} className="om-accent-icon" />}
      title="Description"
      done={!!text}
      open={open}
      onToggle={onToggle}
    >
      {text ? (
        <DescriptionText text={text} onSeek={onSeek} />
      ) : (
        <p className="om-detail-desc" style={{ fontStyle: 'italic' }}>No description available.</p>
      )}
    </RailCard>
  );
}

// Transcript as a rail card: pulls captions/STT on demand, shows source/lang
// tags inline, scrolls within the card, and times stamps stay clickable.
function TranscriptCard({ memo, onSeek, open, onToggle }: { memo: Memo; onSeek?: (sec: number) => void; open: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const status = memo.transcript_status;
  const pending = status === 'pending' || status === 'processing' || starting;
  // Only real spoken-word text counts as done — never the source's description.
  const text = transcriptText(memo);
  const done = !!text;
  const srcLabel = memo.transcript_source === 'captions' ? 'CC' : memo.transcript_source === 'stt' ? 'STT' : null;

  const startTranscribe = async () => {
    setStarting(true);
    try {
      await memoApi.transcribe(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <RailCard
      icon={<FileText size={16} className="om-accent-icon" />}
      title="Transcript"
      done={done}
      badge={pending ? <Loader2 size={12} className="om-spin" style={{ marginLeft: 4 }} /> : null}
      open={open}
      onToggle={onToggle}
    >
      {pending ? (
        <p className="om-detail-desc">
          <Loader2 size={14} className="om-spin" style={{ verticalAlign: -2, marginRight: 6 }} />
          Pulling captions or transcribing… runs locally and may take a moment.
        </p>
      ) : done ? (
        <div className="om-prose om-rail-scroll" style={{ whiteSpace: 'pre-wrap' }}>
          {(srcLabel || memo.transcript_lang) && (
            <p className="om-transcript-tags" style={{ whiteSpace: 'normal' }}>
              {srcLabel && (
                <span className="om-tag" title={memo.transcript_source === 'captions' ? 'From source captions' : 'Whisper speech-to-text'}>{srcLabel}</span>
              )}
              {memo.transcript_lang && (
                <span className="om-tag" style={{ textTransform: 'uppercase' }}>{memo.transcript_lang}</span>
              )}
            </p>
          )}
          <SummaryMarkdown text={text!} onSeek={onSeek} />
        </div>
      ) : status === 'error' || status === 'done' ? (
        // 'done' with no transcript text means the run came back empty — treat it
        // exactly like an error rather than falling back to the description.
        <div>
          <p className="om-detail-desc" style={{ marginBottom: 10 }}>
            Couldn’t get a transcript. The source may have no captions and no speech in its audio, or be private/region-locked.
          </p>
          {canTranscript(memo) && (
            <button className="om-btn-ghost om-btn-pill" onClick={startTranscribe} disabled={starting}>
              <Captions size={14} /> Try again
            </button>
          )}
        </div>
      ) : canTranscript(memo) ? (
        <div>
          <p className="om-detail-desc" style={{ marginBottom: 10 }}>
            No transcript yet. Pull the source’s captions (or transcribe with Whisper) — the video stays put.
          </p>
          <button className="om-btn-primary om-btn-pill" onClick={startTranscribe} disabled={starting}>
            {starting ? <Loader2 size={14} className="om-spin" /> : <Captions size={14} />}
            Get transcript
          </button>
        </div>
      ) : (
        <p className="om-detail-desc">No transcript available for this memo.</p>
      )}
    </RailCard>
  );
}

// "Ask this memo" as a rail card (OPNMMO-0042): a collapsed toggle that opens
// into the chat (input + thread), part of the rail accordion like the others.
function AskRailTool({ memoId, open, onToggle }: { memoId: string; open: boolean; onToggle: () => void }) {
  // The Ask card wears the same colorful border-beam as the Ask composer, but
  // dialed to 20% (strength only touches the beam/glow, not the card). Its head
  // glyph is the Ask robot, matching the panel's own icon (OPNMMO).
  const beam = useBeamConfig();
  const theme = useAppStore((s) => s.tweaks.theme);
  return (
    <BorderBeam
      className="om-rail-beam"
      size={beam.composerSize}
      colorVariant="colorful"
      theme={resolveBeamTheme(beam.themeMode, theme === 'light' ? 'light' : 'dark')}
      borderRadius={20}
      active
      staticColors={beam.staticColors}
      saturation={beam.saturation}
      hueRange={beam.hueRange}
      strength={0.2}
      brightness={beam.ambientBrightness}
      duration={beam.ambientDuration}
    >
      <RailCard
        icon={<Icon name="sparkles" size={16} className="om-accent-icon" />}
        title="Ask this memo"
        open={open}
        onToggle={onToggle}
      >
        <AskMemoPanel memoId={memoId} />
      </RailCard>
    </BorderBeam>
  );
}

export function MemoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openThumbEdit = useAppStore((s) => s.openThumbEdit);
  const setActiveCollection = useAppStore((s) => s.setActiveCollection);
  const isMobile = useIsMobile();
  const [isEditing, setIsEditing] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [showExtracted, setShowExtracted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Add to playlist" popover (music memos only).
  const [plMenuOpen, setPlMenuOpen] = useState(false);
  const [repulling, setRepulling] = useState(false);
  // Theater is lifted so the page grid reflows: video full-width, rail drops
  // below it beside the notes (OPNMMO-0042).
  const [theater, setTheater] = useState(false);
  // Rail accordion: which info card is open (one at a time). Make it local is
  // independent and not tracked here (point 5).
  const [openCard, setOpenCard] = useState<string>('summary');
  const toggleCard = (cardId: string) => setOpenCard((c) => (c === cardId ? '' : cardId));
  // File-backed memos open with their Source file card instead of Summary, so
  // the metadata leads the rail like the old report block did (OPNMMO-0047).
  // Once per memo, and never fights a user toggle afterward.
  const defaultedCard = useRef<string | null>(null);
  const [videoSeek, setVideoSeek] = useState<{ sec: number; nonce: number } | null>(null);
  const seekVideo = useCallback((sec: number) => {
    setVideoSeek((v) => ({ sec, nonce: (v?.nonce ?? 0) + 1 }));
  }, []);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editCollectionIds, setEditCollectionIds] = useState<string[]>([]);

  const { data: memo, isLoading } = useQuery({
    queryKey: ['memo', id],
    queryFn: () => memoApi.get(id!),
    enabled: !!id,
    // While a transcription OR a "make it local" download is running in the
    // background, poll so the result appears as soon as it lands.
    refetchInterval: (q) => {
      const m = q.state.data as Memo | undefined;
      const busy = (s?: string | null) => s === 'pending' || s === 'processing';
      return busy(m?.transcript_status) || busy(m?.localize_status) ? 2500 : false;
    },
  });


  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionApi.list(),
  });

  // Poster aspect for a remote video embed, measured off the thumbnail so a
  // portrait clip (FB reel, YouTube Short) gets a portrait frame instead of a
  // letterbox-cropped 16/9 box. Called here — before the loading/not-found early
  // returns — so the hook order never changes between renders (Rules of Hooks).
  const posterSrc =
    memo && memo.type === 'video' && !memo.file_path && videoEmbedUrl(memo) ? mediaSrc(memo) : null;
  const posterAspect = useImageAspect(posterSrc);

  /* eslint-disable react-hooks/set-state-in-effect */
  // Initialize edit form when memo loads
  useEffect(() => {
    if (memo) {
      setEditTitle(memo.title || '');
      setEditSourceUrl(memo.source_url || '');
      setEditContent(memo.content_raw || memo.content_text || '');
      setEditNotes(memo.notes || '');
      setEditTags(memo.tags || []);
      setEditCollectionIds(memo.collections?.map((c: { id: string }) => c.id) || []);
      setNoteContent(memo.content_raw || memo.content_text || '');
    }
  }, [memo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!memo || defaultedCard.current === memo.id) return;
    defaultedCard.current = memo.id;
    if (memo.type === 'document' || memo.type === 'code' || memo.type === 'file') {
      setOpenCard('metadata');
    }
  }, [memo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!confirmDelete) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmDelete(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [confirmDelete]);

  const togglePin = async () => {
    if (!id || !memo) return;
    try {
      await memoApi.pin(id, !memo.pinned);
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await memoApi.delete(id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      navigate(-1);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await memoApi.update(id, {
        title: editTitle,
        source_url: editSourceUrl,
        content_raw: editContent,
        notes: editNotes,
        tags: editTags,
        collection_ids: editCollectionIds,
      });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = editTagInput.trim().toLowerCase();
    if (t && !editTags.includes(t)) {
      setEditTags([...editTags, t]);
    }
    setEditTagInput('');
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const toggleCollection = (cid: string) => {
    if (editCollectionIds.includes(cid)) {
      setEditCollectionIds(editCollectionIds.filter((c) => c !== cid));
    } else {
      setEditCollectionIds([...editCollectionIds, cid]);
    }
  };

  // Debounced notes auto-save when not in edit mode
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    if (memo?.notes !== undefined) setNotesDraft(memo.notes || ''); // eslint-disable-line react-hooks/set-state-in-effect
  }, [memo?.notes]);

  const saveNotes = useCallback(async () => {
    if (!id || isEditing) return;
    if (notesDraft === (memo?.notes || '')) return;
    setNotesSaving(true);
    try {
      await memoApi.update(id, { notes: notesDraft });
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setNotesSaving(false);
    }
  }, [id, notesDraft, memo?.notes, isEditing, queryClient]);

  useEffect(() => {
    const timer = setTimeout(saveNotes, 1000);
    return () => clearTimeout(timer);
  }, [notesDraft, saveNotes]);

  if (isLoading) {
    return (
      <div className="om-detail-loading">
        <div className="om-detail-spinner" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="om-detail-loading">
        <p className="om-detail-desc">Memo not found</p>
      </div>
    );
  }

  // Inline player for a remote video memo (no local file yet). Covers every
  // platform in the registry — YouTube, Vimeo, Instagram, TikTok, etc. Null →
  // no embeddable player; the "Make it local" panel + Open Original still show.
  const videoEmbed = memo.type === 'video' && !memo.file_path ? videoEmbedUrl(memo) : null;
  // posterAspect is measured up top (before the early returns) so hook order
  // stays stable; resolveEmbedShape itself is a pure call and can run here.
  const videoEmbedShape = resolveEmbedShape(memo, posterAspect);
  const videoEmbedKind = videoEmbed ? videoEmbedShape.kind : 'video';
  const isWebType = memo.type === 'article' || memo.type === 'link';

  // Tool rail (OPNMMO-0042): AI Summary + Make-it-local + future tools hug the
  // content column on desktop. On mobile the rail is hidden — except an already
  // generated summary, which drops inline above the notes. Edit mode shows neither.
  const showSummary = !isEditing && canSummarize(memo);
  const showMakeLocal = !isEditing && canMakeLocal(memo) && memo.type === 'video';
  // Ask-this-memo is a universal rail tool, so the rail is present on every
  // desktop memo (not just summarizable / localizable ones) — OPNMMO-0042.
  const showRail = !isMobile && !isEditing;

  // Every tool now lives in the rail as a homogeneous card (OPNMMO-0042): AI
  // Summary, Description, Transcript, Make it local, Ask. Notes stays out, in
  // the content column. On mobile (no rail) these render inline under the media.
  const isMusicAudio = memo.type === 'audio' && audioKind(memo) === 'music';
  const showDescription = !isEditing && (memo.type === 'video' || isMusicAudio);
  const showTranscript = !isEditing
    && (memo.type === 'video' || (memo.type === 'audio' && !isMusicAudio))
    && (canTranscript(memo) || !!memo.transcript_status || !!memo.content_text);
  // Order: Description, AI Summary, Transcript, Make it local, Ask — all one
  // accordion (one card open at a time). A card's internal state (Make it local's
  // quality picks, a transcript in flight) lives in its body and never toggles it.
  // File-backed memos (doc / code / file) lead the rail with their source +
  // metadata card, then AI Summary, then Ask (OPNMMO-0047).
  const showMetadata = !isEditing && (memo.type === 'document' || memo.type === 'code' || memo.type === 'file');
  const railTools: React.ReactNode[] = [];
  if (showMetadata) railTools.push(<MetadataRailCard key="metadata" memo={memo} open={openCard === 'metadata'} onToggle={() => toggleCard('metadata')} />);
  if (showDescription) railTools.push(<DescriptionCard key="desc" memo={memo} open={openCard === 'description'} onToggle={() => toggleCard('description')} onSeek={seekVideo} />);
  if (showSummary) railTools.push(<SummaryPanel key="summary" memo={memo} onSeek={seekVideo} open={openCard === 'summary'} onToggle={() => toggleCard('summary')} />);
  if (showTranscript) railTools.push(<TranscriptCard key="transcript" memo={memo} onSeek={seekVideo} open={openCard === 'transcript'} onToggle={() => toggleCard('transcript')} />);
  if (showMakeLocal) railTools.push(<MakeItLocalPanel key="makelocal" memo={memo} open={openCard === 'makelocal'} onToggle={() => toggleCard('makelocal')} />);
  if (!isEditing) railTools.push(<AskRailTool key="ask" memoId={id!} open={openCard === 'ask'} onToggle={() => toggleCard('ask')} />);

  return (
    <div className="om-detail-page">
      {/* Content pane */}
      <div className="om-detail-pane">
        {/* Header */}
        <header className="om-detail-top">
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BackButton />
          </div>
          <div className="om-detail-actions">
            {/* Add to playlist — music memos only, same popover as cards. */}
            {!isEditing && audioKind(memo) === 'music' && (
              <div style={{ position: 'relative' }}>
                <button
                  className="om-icon-btn"
                  onClick={() => setPlMenuOpen((v) => !v)}
                  title="Add to playlist"
                  aria-label="Add to playlist"
                  aria-expanded={plMenuOpen}
                >
                  <Icon name="listMusic" size={15} />
                </button>
                {plMenuOpen && (
                  <PlaylistMenu
                    memoId={memo.id}
                    memberIds={(memo.collections ?? []).map((c: { id: string }) => c.id)}
                    onClose={() => setPlMenuOpen(false)}
                  />
                )}
              </div>
            )}
            {/* Delete with inline confirm popover */}
            {!isEditing && (
              <div style={{ position: 'relative' }}>
                <button
                  className="om-icon-btn"
                  onClick={() => setConfirmDelete((v) => !v)}
                  title="Delete memo"
                  aria-label="Delete memo"
                >
                  <Trash2 size={15} />
                </button>
                {confirmDelete && (
                  <div
                    className="om-delete-confirm"
                    role="dialog"
                    aria-label="Confirm delete"
                  >
                    <span className="om-delete-confirm-label">Delete memo?</span>
                    <button className="om-btn-ghost om-btn-pill" onClick={() => setConfirmDelete(false)}>Cancel</button>
                    <button className="om-btn-danger om-btn-pill" onClick={handleDelete}>Delete</button>
                  </div>
                )}
              </div>
            )}
            {/* Re-pull: fetch the source again and apply what comes back.
                For a memo that is wrong rather than merely remote — a video
                that will not play, a caption still reading "Instagram post",
                a carousel that arrived as one photo. Uploads have no source,
                so they do not get the button. */}
            {!isEditing && memo.source_url && (
              <button
                className="om-icon-btn"
                disabled={repulling || memo.localize_status === 'pending' || memo.localize_status === 'processing'}
                onClick={async () => {
                  setRepulling(true);
                  try {
                    await memoApi.repull(memo.id);
                    // The work runs detached, so poll the memo until it settles
                    // rather than leaving the button spinning on a guess.
                    const started = Date.now();
                    const tick = setInterval(async () => {
                      const fresh = await memoApi.get(memo.id).catch(() => null);
                      queryClient.invalidateQueries({ queryKey: ['memo', memo.id] });
                      const settled = fresh && fresh.localize_status !== 'pending' && fresh.localize_status !== 'processing';
                      if (settled || Date.now() - started > 5 * 60_000) {
                        clearInterval(tick);
                        setRepulling(false);
                      }
                    }, 2500);
                  } catch (e) {
                    setRepulling(false);
                    alert((e as Error).message || 'Could not start the re-pull');
                  }
                }}
                title="Pull this memo's source again — media, caption and cover"
                aria-label="Pull this memo's source again"
              >
                <RefreshCw size={15} className={repulling ? 'om-spin' : undefined} />
              </button>
            )}
            {/* Pin + Export as header icon buttons (tooltip via title), next to
                delete — moved out of the meta row so tags flow free below. */}
            {!isEditing && (
              <button
                className={cn('om-icon-btn', memo.pinned && 'active')}
                onClick={togglePin}
                title={memo.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                aria-label={memo.pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                aria-pressed={!!memo.pinned}
              >
                {memo.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </button>
            )}
            {!isEditing && memo.file_path && (
              <a
                className="om-icon-btn"
                href={`/api/memos/${memo.id}/file?download=1`}
                download
                title="Export this memo"
                aria-label="Export this memo"
              >
                <Download size={15} />
              </a>
            )}
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="om-btn-ghost om-btn-pill"
              >
                <Pencil size={14} />
                Edit
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="om-btn-primary om-btn-pill"
                  style={saving ? { opacity: 0.5 } : undefined}
                >
                  {saving ? <Loader2 size={14} className="om-spin" /> : <Save size={14} />}
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="om-btn-ghost om-btn-pill"
                >
                  <X size={14} />
                  Cancel
                </button>
              </>
            )}
            {memo.source_url && !isEditing && (
              <a
                href={memo.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="om-btn-ghost om-btn-pill"
              >
                <ExternalLink size={14} />
                Open Original
              </a>
            )}
            {/* Ask this memo now lives as a rail/inline card on every memo, so
                the header chat toggle is gone (OPNMMO-0042). */}
          </div>
        </header>

        {/* Content */}
        <div className="om-detail-scroll">
          <div className={cn('om-detail-content', showRail && 'has-rail', theater && 'is-theater')}>
          {/* Header spans full width above the columns so the rail's top edge
              lines up with the bottom of the title block (OPNMMO-0042). */}
          <div className="om-detail-head-block">
            {/* Memo type */}
            {/* Title (memo type moved into the meta row below) */}
            {isEditing ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="om-detail-title-input"
                style={{ marginBottom: '8px' }}
              />
            ) : (
              <h1 className="om-detail-title" style={{ marginBottom: '8px' }} title={isLongTitle(memo.title) ? memo.title : undefined}>{truncateTitle(memo.title)}</h1>
            )}

            {isEditing && (
              <button
                className="om-btn-secondary"
                onClick={() => openThumbEdit(memo)}
                style={{ marginBottom: 12 }}
              >
                <ImageIcon size={13} /> Change thumbnail &amp; title
              </button>
            )}

            {/* Meta — two clusters: descriptive facts (what this memo is) on the
                left, actions (what you can do) pushed to the right (OPNMMO-0042). */}
            <div className="om-detail-meta" style={{ marginBottom: '24px' }}>
              {/* Facts: type · date · source · collections · tags */}
              <div className="om-detail-meta-facts">
                <span className="om-section-h">{memo.type}</span>
                <span className="om-meta-dot">•</span>
                <span className="mono om-meta-date">
                  {new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
                {memo.source_domain && !isEditing && (
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="om-source"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />}
                    {memo.source_domain}
                    <ExternalLink size={12} />
                  </a>
                )}
                {!isEditing && memo.collections?.map((c: CollectionRef) => {
                  const full = collections.find((fc: Collection) => fc.id === c.id);
                  return (
                    <button
                      key={c.id}
                      className="om-meta-coll"
                      onClick={() => { setActiveCollection(c.id); navigate('/'); }}
                      title={`View “${c.name}”`}
                    >
                      <span className="om-meta-coll-emoji">{full?.emoji || '📁'}</span>
                      {c.name}
                    </button>
                  );
                })}
                {!isEditing && memo.tags?.map((tag: string) => (
                  <span key={tag} className="om-tag">{tag}</span>
                ))}
                {isEditing && (
                  <input
                    value={editSourceUrl}
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                    placeholder="Source URL"
                    className="om-detail-url-input"
                  />
                )}
              </div>
              {/* Pin / Export moved to the header icon cluster (next to delete).
                  The facts cluster now owns the full row so tags wrap freely. */}
            </div>

            {/* Edit: Tags */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Tag size={14} className="om-section-icon" />
                  <span className="om-section-h">Tags</span>
                </div>
                <div className="om-detail-tags">
                  {editTags.map((tag) => (
                    <span key={tag} className="om-tag-edit">
                      {tag}
                      <button onClick={() => removeTag(tag)}><X size={12} /></button>
                    </span>
                  ))}
                  <span className="om-tag-add">
                    <input
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                      placeholder="Add tag..."
                      style={{ background: 'none', border: 0, outline: 'none', font: 'inherit', color: 'inherit', minWidth: '80px' }}
                    />
                  </span>
                </div>
              </div>
            )}

            {/* Edit: Collections */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-notes-label" style={{ marginBottom: '8px' }}>
                  <Folder size={14} className="om-section-icon" />
                  <span className="om-section-h">Collections</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {collections.map((col: Collection) => (
                    <button
                      key={col.id}
                      onClick={() => toggleCollection(col.id)}
                      className={`om-coll-chip${editCollectionIds.includes(col.id) ? ' active' : ''}`}
                    >
                      {col.emoji} {col.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>{/* /.om-detail-head-block */}

          {/* Left column = media + notes, kept together so the rail is its own
              independent column: opening a rail card never shifts the notes
              (OPNMMO-0042 point 1). In theater this becomes display:contents so
              the media can span full width with notes below. */}
          <div className="om-detail-col-main">
          <div className="om-detail-main">
            {/* AI Summary lives in the tool rail (desktop) and as a toggle
                section under the content (OPNMMO-0042). */}

            {/* Source + metadata for file-backed memos moved into the rail as
                the first card (OPNMMO-0047), so the content column is the file. */}

            {/* Pin / Download moved into the meta row above (inline with date +
                source), so no separate action row here. */}

            {/* Image preview — with lightbox, theater, fullscreen. Uploaded
                images serve from the file route; scraped image memos (a Facebook
                /photo, an Instagram/X photo, etc.) have no local file — their
                real, localized image lives in thumbnail_path. */}
            {memo.type === 'image' && !isEditing && memo.gallery && memo.gallery.length > 1 ? (
              <GalleryCarousel gallery={memo.gallery} alt={memo.title} />
            ) : memo.type === 'image' && !isEditing && (memo.file_path || memo.thumbnail_path) ? (
              <MediaPreview
                src={memo.file_path ? `/api/memos/${memo.id}/file` : memo.thumbnail_path || ''}
                alt={memo.title}
                kind="image"
                theater={theater}
                onTheaterChange={setTheater}
              />
            ) : null}

            {/* Local video preview — with theater + fullscreen */}
            {memo.type === 'video' && memo.file_path && !isEditing && (
              <MediaPreview src={`/api/memos/${memo.id}/file`} alt={memo.title} kind="video" poster={memo.thumbnail_path} seek={videoSeek} theater={theater} onTheaterChange={setTheater} />
            )}

            {/* Audio memo (ADR-005) — never a dead end. A local/pulled file plays
                in our player; a remote source always falls through to the live
                platform widget or a progress/retry panel. Replaces the old split
                that rendered nothing when localize was done-without-file or when
                auto-download hid the live embed. */}
            {memo.type === 'audio' && !isEditing && (
              memo.file_path ? (
                <>
                  {audioKind(memo) === 'music' && memo.thumbnail_path ? (
                    <MusicDetailPlayer memo={memo} />
                  ) : (
                    <AudioMemoPlayer memo={memo} />
                  )}
                  {/* Transcript (voice) and Description (music) now live in the
                      tool rail as cards (OPNMMO-0042). */}
                  {/* Keep the source reachable as a live reference even after pull. */}
                  {memo.source_url && audioEmbed(memo) && <AudioStreamEmbed memo={memo} reference />}
                </>
              ) : (memo.localize_status === 'pending' ||
                   memo.localize_status === 'processing' ||
                   memo.localize_status === 'error') ? (
                // A pull is in flight or failed → progress / retry (Open original inside).
                <MakeItLocalPanel memo={memo} />
              ) : (
                // No local file, not pulling → live platform widget (or graceful
                // Open-original fallback) + Save-to-openMemo.
                <AudioStreamEmbed memo={memo} />
              )
            )}

            {/* Inline platform embed (YouTube, Vimeo, Instagram, TikTok, X, …) */}
            {videoEmbed && !isEditing && (
              <PlatformEmbed memo={memo} src={videoEmbed} kind={videoEmbedKind} aspectRatio={videoEmbedShape.aspectRatio} seek={videoSeek} />
            )}

            {/* Portrait-platform hint: Instagram/TikTok embeds carry full platform UI.
                Nudge user toward Make it Local for a clean native player. */}
            {videoEmbed && !isEditing && videoEmbedKind === 'portrait' && canMakeLocal(memo) && !memo.file_path && (
              <p className="om-detail-desc" style={{ marginBottom: 16, marginTop: -8 }}>
                Want just the video without the platform UI? Save locally below for a clean native player.
              </p>
            )}

            {/* Un-embeddable remote video: the host has no iframe player
                (Threads, Facebook, and others — see platforms.ts) and no local
                file has been pulled yet. Without this the page shows only tool
                cards and looks empty. Render the poster as a play button that
                opens the original; "Make it local" (rail) pulls a native file. */}
            {memo.type === 'video' && !videoEmbed && !memo.file_path && !isEditing && (
              <a
                className={cn('om-detail-poster', !memo.thumbnail_path && 'no-thumb')}
                href={memo.source_url || undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {memo.thumbnail_path && <img src={memo.thumbnail_path} alt={memo.title} />}
                <span className="om-detail-poster-play">
                  <Play size={22} style={{ fill: 'currentColor' }} />
                </span>
                <span className="om-detail-poster-hint">
                  <ExternalLink size={13} />
                  Open on {memo.source_domain || 'original site'}
                </span>
              </a>
            )}

            {/* (Audio remote handling moved into the unified audio block above.) */}

            {/* Make it local, Video description and Transcript all moved to the
                tool rail as homogeneous cards (OPNMMO-0042). */}

            {/* Rich Web Preview for article/link */}
            {isWebType && !isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <div className="om-web-card">
                  {memo.thumbnail_path && (
                    <div className="om-web-card-thumb">
                      <img src={memo.thumbnail_path} alt="" onError={(e) => { (e.target as HTMLImageElement).closest('.om-web-card-thumb')?.remove(); }} />
                    </div>
                  )}
                  <div className="om-web-card-body">
                    <div className="om-web-card-source">
                      {memo.source_favicon ? (
                        <img src={memo.source_favicon} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
                      ) : (
                        <GlobeIcon size={18} className="om-section-icon" />
                      )}
                      <span className="om-web-card-domain">{memo.source_domain || 'Website'}</span>
                    </div>
                    <h2 className="om-web-card-title">{memo.title}</h2>
                    {memo.description && (
                      <p className="om-web-card-desc">{memo.description}</p>
                    )}
                    <a
                      href={memo.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="om-btn-primary om-btn-pill"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Open Original
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>

                {/* Collapsible extracted content */}
                {(memo.content_text || memo.content_raw) && (
                  <div style={{ marginTop: '16px' }}>
                    <button
                      onClick={() => setShowExtracted(!showExtracted)}
                      className="om-extracted-toggle"
                    >
                      {showExtracted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showExtracted ? 'Hide extracted content' : 'Show extracted content'}
                    </button>
                    {showExtracted && (
                      <div className="om-extracted-body om-prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Content body for note — on the same reading surface as
                document/code files, so long-form text never floats raw on the
                decorative page background (OPNMMO-0047 standard). */}
            {memo.type === 'note' && !isEditing && (
              <div className="om-file-content">
                <MarkdownEditor
                  viewFirst
                  value={noteContent}
                  onSave={(val) => {
                    setNoteContent(val);
                    memoApi.update(memo.id, { content_raw: val, content_text: val }).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['memo', id] });
                      queryClient.invalidateQueries({ queryKey: ['memos'] });
                    });
                  }}
                  placeholder="Click to write your note..."
                />
              </div>
            )}

            {/* Document / code content — on its own surface card so the file
                content sits in a panel instead of floating on the page bg
                (OPNMMO-0047). */}
            {(memo.type === 'document' || memo.type === 'code') && !isEditing && memo.content_text && (
              <div className="om-file-content">
                <div className="om-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo.content_raw || memo.content_text}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Edit: Content */}
            {isEditing && (
              <div style={{ marginBottom: '24px' }}>
                <label className="om-field-label-block">Content</label>
                <MarkdownEditor
                  value={editContent}
                  onChange={(val) => setEditContent(val)}
                  placeholder="Write content..."
                />
              </div>
            )}

            {/* Mobile (no rail): the tool cards render inline under the media,
                since the rail is desktop-only (OPNMMO-0042). */}
            {!showRail && railTools.length > 0 && (
              <div className="om-rail-inline">{railTools}</div>
            )}

            {/* Related memos: removed for now (revisit the UX). The /related
                endpoint + UI are in git history if/when it comes back. */}
          </div>{/* /.om-detail-main */}

          {/* Notes — under the media in the same left column, so it stays put
              regardless of which rail card is open. */}
          <div className="om-detail-notes-area">
            <div className="om-notes-section">
              <div className="om-notes-head">
                <div className="om-notes-label">
                  <Pencil size={16} className="om-section-icon" />
                  <h3 className="om-section-h">My Notes</h3>
                </div>
                {notesSaving && <Loader2 size={14} className="om-section-icon om-spin" />}
              </div>
              <MarkdownEditor
                viewFirst={!isEditing}
                value={isEditing ? editNotes : notesDraft}
                onChange={isEditing ? (val) => setEditNotes(val) : (val) => setNotesDraft(val)}
                onSave={(val) => {
                  if (isEditing) return;
                  memoApi.update(memo.id, { notes: val }).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['memo', id] });
                  });
                }}
                placeholder="Click to add your thoughts, annotations, or highlights..."
              />
            </div>
          </div>
          </div>{/* /.om-detail-col-main */}

          {/* Tool rail (desktop) — its own independent column: AI Summary,
              Description, Transcript, Make it local, Ask this memo (OPNMMO-0042). */}
          {showRail && <aside className="om-detail-rail">{railTools}</aside>}
          </div>{/* /.om-detail-content */}
        </div>
      </div>
    </div>
  );
}

function GlobeIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size || 24}
      height={size || 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
