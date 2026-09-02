import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { CardLink } from './CardLink';
import { isPlainClick } from '@/lib/nav';
import { useQueryClient } from '@tanstack/react-query';
import type { DraggableAttributes } from '@dnd-kit/core';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
import { mediaSrc, audioKind, isMemoWorking } from '@/lib/media';
import { imgAspect, aspectToOrient } from '@/lib/aspect';
import { useCoverMood, type CoverMood } from '@/lib/coverMood';
import { platformMeta, videoEmbedUrl } from '@/lib/platforms';
import { useAppStore } from '@/stores/appStore';
import { useAudioPlayer, formatTime } from '@/lib/audioPlayer';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil } from 'lucide-react';
import { LiveWaveform } from './LiveWaveform';
import { Marquee } from './Marquee';
import { VolumeControl } from './VolumeControl';
import { PlaylistMenu } from './PlaylistMenu';
import type { Memo, MemoType } from '@/types';

// Warm tint palette for cards without media (notes / plain docs).
const NOTE_TINTS = [
  { bg: '#E8DCC4', text: '#3B2F1E' },
  { bg: '#D9C9A8', text: '#3B2F1E' },
  { bg: '#E0D7CB', text: '#3A322A' },
  { bg: '#2A2622', text: '#E8DCC4' },
];
const TINT_FALLBACK = ['#E8D9B8', '#E8C7A0', '#D9B89C', '#C7A88E', '#BFAA9A'];

function hashId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function rootDomain(domain?: string | null): string {
  if (!domain) return '';
  try {
    const host = domain.includes('//') ? new URL(domain).hostname : domain.split('/')[0];
    return host.replace(/^www\./, '');
  } catch {
    return domain.split('/')[0];
  }
}

function typeIcon(t: MemoType) {
  return (
    { note: 'fileText', link: 'link', article: 'globe', image: 'image', video: 'video', document: 'file', audio: 'mic', code: 'code', file: 'file' } as Record<string, string>
  )[t] || 'file';
}
function typeLabel(t: MemoType) {
  return (
    { note: 'Note', link: 'Link', article: 'Article', image: 'Image', video: 'Video', document: 'File', audio: 'Audio' } as Record<string, string>
  )[t] || 'Memo';
}

// Inline SVG file icon with the extension burned in. Single component, the
// extension is passed in as a prop — avoids maintaining a library of per-type
// icons. Renders crisp at any DPR and adapts to the active text color.
function FileBadge({ ext }: { ext: string }) {
  const label = ext ? `.${ext.toLowerCase()}` : '';
  // Auto-shrink long extensions so unusual ones (`.markdown`, `.dockerfile`)
  // still fit inside the icon body.
  const len = label.length;
  const size = len <= 5 ? 36 : len <= 7 ? 28 : len <= 10 ? 22 : 18;
  return (
    <svg viewBox="0 0 200 240" className="om-file-svg" role="img" aria-label={label || 'file'}>
      <path
        d="M40 14 H128 L172 58 V216 Q172 226 162 226 H40 Q30 226 30 216 V24 Q30 14 40 14 Z"
        fill="currentColor"
        fillOpacity="0.10"
      />
      <path
        d="M40 14 H128 L172 58 V216 Q172 226 162 226 H40 Q30 226 30 216 V24 Q30 14 40 14 Z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <path
        d="M128 14 V48 Q128 58 138 58 H172"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="2"
      />
      {label && (
        <text
          x="100"
          y="190"
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          fontSize={size}
          fontWeight="600"
          fill="currentColor"
          letterSpacing="0.5"
        >
          {label}
        </text>
      )}
    </svg>
  );
}

// Brand glyph for the minimal video card's bottom-left pill. Priority:
//   1. hand-drawn brand glyph for known platforms (YouTube, Instagram, TikTok…)
//   2. the source's favicon — covers every other host (Threads, Dailymotion,
//      Rumble, Bilibili…) so a remote video never shows a bare generic icon
//   3. generic video icon (local uploads / no source)
function VideoSourceIcon({ memo }: { memo: Memo }) {
  const meta = platformMeta(memo);
  if (meta?.glyph) return <Icon name={meta.glyph} size={13} className={meta.brandClass} />;
  if (memo.source_url && memo.source_favicon)
    return (
      <img
        draggable={false}
        src={memo.source_favicon}
        alt=""
        width={13}
        height={13}
        style={{ borderRadius: 3, flexShrink: 0 }}
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
    );
  return <Icon name="video" size={12} />;
}

interface DragProps {
  attributes: DraggableAttributes;
  listeners?: Record<string, unknown>;
}

// "Working" state for a memo still being pulled in the background (OPNMMO-0050).
// yt-dlp / headless scrape (auto-download) and embedding both take a beat after
// the card first appears; without this the card looks finished while the backend
// is still fetching. A small, on-brand chip rides the top-left corner with a
// soft sweep across the card so the user can see it is actively working. It
// resolves to the finished card the moment the memo settles (the grid polls
// while any card is working). A localize error never lands here — `isMemoWorking`
// returns false for it, so a failed pull surfaces its own error chip instead of
// spinning forever.
function WorkingBadge({ memo }: { memo: Memo }) {
  const downloading = memo.localize_status === 'pending' || memo.localize_status === 'processing';
  const label = downloading ? 'Pulling' : 'Saving';
  return (
    <div className="om-card-working" aria-hidden>
      <div className="om-card-working-sweep" />
      <span className="om-card-working-chip mono">
        <Icon name="refresh" size={11} className="om-spin" />
        <span>{label}</span>
      </span>
    </div>
  );
}

function Chrome({
  memo,
  className,
  style,
  dragHandleProps,
  onDelete,
  onPin,
  bgSrc,
  children,
  dataTint,
  onCardClick,
  onOpen,
  confirmOverlay,
  playerOverlay,
}: {
  memo: Memo;
  className?: string;
  style?: React.CSSProperties;
  dragHandleProps?: DragProps;
  onDelete: (e: React.MouseEvent) => void;
  onPin: (e: React.MouseEvent) => void;
  bgSrc?: string | null;
  children: React.ReactNode;
  dataTint?: number;
  onCardClick?: () => void;
  /** Show the open-in-page arrow. The destination is the memo, always, so
   *  this is a flag rather than a handler: the arrow is a real link. */
  onOpen?: boolean;
  confirmOverlay?: React.ReactNode;
  playerOverlay?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const openThumbEdit = useAppStore((s) => s.openThumbEdit);
  // "Add to playlist" — music memos only, touch-first (no drag needed).
  const [plMenuOpen, setPlMenuOpen] = React.useState(false);
  const isMusicCard = audioKind(memo) === 'music';
  // User-resizable tile (dashboard grids): wide = two columns. Persisted per
  // memo; the grid re-lays out live off the invalidated memos query.
  const isWide = memo.card_size === 'wide';
  const handleToggleWide = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await memoApi.setCardSize(memo.id, isWide ? 'normal' : 'wide');
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch {
      /* ignore — next click retries */
    }
  };
  // EVERY card is covered by a real anchor to its memo, including the ones
  // whose plain click does something else.
  //
  // An image or a playable video opens the lightbox when you click it, which
  // is right, and the first pass therefore skipped the anchor on those cards
  // entirely. That left them with no way to be opened in a new tab at all,
  // which is exactly what this whole change was for.
  //
  // So the anchor is always there and the lightbox intercepts only the plain
  // click. A modified click is never touched, so ctrl+click and middle-click
  // open the memo page, right-click offers copy-link-address, and the status
  // bar shows where it goes. The lightbox behaves exactly as before.
  const interceptPlainClick = onCardClick
    ? (e: React.MouseEvent) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onCardClick();
      }
    : undefined;
  return (
    <div
      {...(dragHandleProps?.attributes || {})}
      {...(dragHandleProps?.listeners || {})}
      className={cn('om-card om-card-hover', isMemoWorking(memo) && 'is-working', className)}
      style={style}
      data-tint={dataTint !== undefined ? String(dataTint) : undefined}
    >
      <CardLink to={`/memo/${memo.id}`} label={memo.title} onClick={interceptPlainClick} />
      {bgSrc && (
        <div className="om-card-dom" aria-hidden>
          <span style={{ backgroundImage: `url(${bgSrc})` }} />
        </div>
      )}
      {confirmOverlay}
      {isMemoWorking(memo) && <WorkingBadge memo={memo} />}
      {/* Pen on EVERY card: edit its thumbnail + title, whatever the memo
          type. It always sits directly under the delete ✕ — the position
          rules just track where that ✕ lives per variant (row, minimal
          column, or the active music card whose actions move left).
          stopPropagation so it never triggers the card click / drag. */}
      <button
        className="om-action om-card-edit"
        onClick={(e) => { e.stopPropagation(); openThumbEdit(memo); }}
        onPointerDown={(e) => e.stopPropagation()}
        data-tip="Edit thumbnail & title"
        aria-label="Edit thumbnail and title"
      >
        <Pencil size={12} />
      </button>
      {/* No `initial={false}` — it propagates via PresenceContext and makes the
          child skip its enter tween (pop-in). We want the enter animated too. */}
      <AnimatePresence>{playerOverlay}</AnimatePresence>
      <div className="om-card-actions">
        {onOpen && (
          <Link
            to={`/memo/${memo.id}`}
            className="om-action"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            data-tip="Open memo page"
            aria-label="Open memo"
          >
            <Icon name="arrowUpRight" size={14} />
          </Link>
        )}
        {isMusicCard && (
          <button
            className={cn('om-action', plMenuOpen && 'pinned')}
            onClick={(e) => { e.stopPropagation(); setPlMenuOpen((v) => !v); }}
            onPointerDown={(e) => e.stopPropagation()}
            data-tip="Add to playlist"
            aria-label="Add to playlist"
            aria-expanded={plMenuOpen}
          >
            <Icon name="listMusic" size={14} />
          </button>
        )}
        <button
          className={cn('om-action', isWide && 'pinned')}
          onClick={handleToggleWide}
          onPointerDown={(e) => e.stopPropagation()}
          data-tip={isWide ? 'Back to one column' : 'Make it wide'}
          aria-label={isWide ? 'Resize card to one column' : 'Resize card to two columns'}
          aria-pressed={isWide}
        >
          <Icon name="resizeWide" size={14} />
        </button>
        <button
          className={cn('om-action', memo.pinned && 'pinned')}
          onClick={onPin}
          data-tip={memo.pinned ? 'Unpin' : 'Pin to sidebar'}
          aria-label={memo.pinned ? 'Unpin' : 'Pin to sidebar'}
        >
          <Icon name="pin" size={14} />
        </button>
        <button className="om-action" onClick={onDelete} data-tip="Delete" aria-label="Delete">
          <Icon name="x" size={15} />
        </button>
      </div>
      {plMenuOpen && (
        <PlaylistMenu
          memoId={memo.id}
          memberIds={(memo.collections ?? []).map((c) => c.id)}
          onClose={() => setPlMenuOpen(false)}
        />
      )}
      {children}
    </div>
  );
}

function Meta({ memo }: { memo: Memo }) {
  const date = new Date(memo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div className="om-meta">
      <div className="om-meta-left">
        {memo.source_favicon ? (
          <img
            draggable={false}
            src={memo.source_favicon}
            alt=""
            className="om-favicon"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <Icon name={typeIcon(memo.type)} size={11} />
        )}
        <span className="om-meta-domain">{memo.source_domain || typeLabel(memo.type)}</span>
      </div>
      <span className="om-meta-date mono">{date}</span>
    </div>
  );
}

// Inline player that takes over a MUSIC card while it's the active track
// (ADR-005). Like the delete-confirm overlay, it sits absolute inset:0 over the
// card at the SAME size — no resize, no cover zoom — so nothing jumps. The cover
// stays crisp; a bottom→top gradient (mood tint + a blur behind the controls)
// carries the transport + title. Voice memos never get this (waveform stays).
function CardMusicPlayer({ memo, cover, mood }: { memo: Memo; cover?: string | null; mood?: CoverMood | null }) {
  const queryClient = useQueryClient();
  const { toggle, seek, playing, currentTime, duration, isActive, repeat, toggleRepeat } = useAudioPlayer();
  const [pinned, setPinned] = React.useState(!!memo.pinned);
  const active = isActive(memo.id);
  const hasDur = Number.isFinite(duration) && duration > 0;
  const pct = active && hasDur ? Math.min(100, (currentTime / duration) * 100) : 0;
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!hasDur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };
  const onPin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    try {
      await memoApi.pin(memo.id, next);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch {
      setPinned(!next);
    }
  };
  return (
    <motion.div
      key="player"
      className={cn('om-card-player', mood && 'is-tinted')}
      role="group"
      aria-label="Now playing"
      style={mood ? ({ ['--cov-base']: mood.base, ['--cov-deep']: mood.deep } as React.CSSProperties) : undefined}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {cover && <div className="om-card-player-cover" style={{ backgroundImage: `url(${cover})` }} aria-hidden />}
      <div className="om-card-player-scrim" aria-hidden />
      {/* The cover opens the memo. A link rather than a click handler, so the
          now-playing card can be ctrl+clicked like everything else. Sits under
          the transport controls, which carry their own z-index. */}
      <CardLink to={`/memo/${memo.id}`} label={memo.title} />

      {/* Corner transport cluster (ADR-010): play is the primary, top-right
          corner; pin + repeat are smaller satellites. No centered play button —
          the cover stays unobstructed. */}
      <button
        className="om-card-player-play"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        aria-label={playing && active ? 'Pause' : 'Play'}
        title={playing && active ? 'Pause' : 'Play'}
      >
        <Icon name={playing && active ? 'pause' : 'play'} size={20} stroke={0} style={{ fill: 'currentColor' }} />
      </button>
      <button
        className={cn('om-card-player-sat om-card-player-pin', pinned && 'active')}
        onClick={onPin}
        title={pinned ? 'Unpin memo' : 'Pin memo'}
        aria-pressed={pinned}
        aria-label="Pin memo"
      >
        <Icon name="pin" size={15} />
      </button>
      <button
        className={cn('om-card-player-sat om-card-player-repeat', repeat && 'active')}
        onClick={(e) => { e.stopPropagation(); toggleRepeat(); }}
        title={repeat ? 'Repeat one: on' : 'Repeat one: off'}
        aria-pressed={repeat}
        aria-label="Repeat one"
      >
        <Icon name={repeat ? 'repeat1' : 'repeat'} size={15} />
      </button>

      {/* Bottom: scrubber above the volume + one-line title row. */}
      <div className="om-card-player-bottom">
        <div className="om-card-player-scrub">
          <span className="om-card-player-time mono">{formatTime(active ? currentTime : 0)}</span>
          <div
            className="om-card-player-track"
            onClick={onScrub}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className="om-card-player-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="om-card-player-time mono">{hasDur ? formatTime(duration) : '--:--'}</span>
        </div>
        <VolumeControl size={18}>
          <Link
            to={`/memo/${memo.id}`}
            className="om-card-player-title"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          >
            <Marquee text={memo.title} auto />
          </Link>
        </VolumeControl>
      </div>
    </motion.div>
  );
}

interface CardProps {
  memo: Memo;
  dragHandleProps?: DragProps;
  // Ordered media memos in the same grid — lets the shared lightbox page
  // prev/next across siblings. Falls back to just this memo when absent.
  lightboxGroup?: Memo[];
}

export function MemoCard({ memo, dragHandleProps, lightboxGroup }: CardProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openLightbox = useAppStore((s) => s.openLightbox);
  const showDeleteToast = useAppStore((s) => s.showDeleteToast);
  const showNotice = useAppStore((s) => s.showNotice);
  const { play, playing, isActive } = useAudioPlayer();
  const [imageOrient, setImageOrient] = React.useState<'landscape' | 'portrait'>('landscape');
  // Real width/height ratio, captured on load. Drives edge-mode masonry so each
  // tile keeps its source proportions instead of a forced square. Video tracks
  // its own (a thumbnail/reel is not always 16:9) via the same shared checker.
  const [imageAR, setImageAR] = React.useState<number | null>(null);
  const [videoOrient, setVideoOrient] = React.useState<'landscape' | 'portrait'>('landscape');
  const [videoAR, setVideoAR] = React.useState<number | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  // A document cover can be stored and still not be on disk (a half-restored
  // backup, a thumb cleared by hand). Fall back to the drawn stack rather than
  // to a broken image, which is what hiding the <img> would leave behind.
  const [coverFailed, setCoverFailed] = React.useState(false);

  const showInLightbox = () => {
    const group = lightboxGroup && lightboxGroup.length ? lightboxGroup : [memo];
    const idx = group.findIndex((m) => m.id === memo.id);
    openLightbox(group, idx >= 0 ? idx : 0);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(false);
    try {
      await memoApi.delete(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
      showDeleteToast(memo.id, memo.title);
    } catch {
      showNotice('Couldn’t delete that memo. Try again.');
    }
  };

  // Hide (OPNMMO-0016): drops the memo from the main dashboard but keeps it in
  // its collections; it resurfaces in the passcode-gated hidden section. On an
  // already-hidden memo (hidden section grid) the same slot unhides instead.
  const confirmHide = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(false);
    try {
      await memoApi.hide(memo.id, !memo.hidden);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch {
      showNotice(memo.hidden ? 'Couldn’t unhide that memo. Try again.' : 'Couldn’t hide that memo. Try again.');
    }
  };

  const closeConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(false);
  };

  const confirmOverlay = confirmDeleteOpen ? (
    <div className="om-card-confirm" role="dialog" onClick={closeConfirm}>
      <button className="om-card-confirm-close" onClick={closeConfirm} title="Cancel" aria-label="Cancel">
        <Icon name="x" size={14} />
      </button>
      <div className="om-card-confirm-inner" onClick={(e) => e.stopPropagation()}>
        <p className="om-card-confirm-title">Delete memo?</p>
        <div className="om-card-confirm-actions">
          <button className="om-confirm-btn" onClick={confirmHide}>{memo.hidden ? 'Unhide' : 'Hide'}</button>
          <button className="om-confirm-btn danger" onClick={confirmDelete} autoFocus>Delete</button>
        </div>
        <p className="om-card-confirm-hint">
          {memo.hidden
            ? 'Unhide puts it back on the dashboard.'
            : 'Hide moves it to the Hidden section, off the dashboard.'}
        </p>
      </div>
    </div>
  ) : null;

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await memoApi.pin(memo.id, !memo.pinned);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch {
      /* ignore */
    }
  };

  const src = mediaSrc(memo);
  const fallbackTint = TINT_FALLBACK[hashId(memo.id) % TINT_FALLBACK.length];
  const heroBg = `linear-gradient(135deg, ${fallbackTint} 0%, color-mix(in oklab, ${fallbackTint} 55%, #1a1a18) 100%)`;

  // Cover-mood color for the active music card's glow + inline player tint
  // (ADR-005). Only extracted for the card that is actually the active music
  // track, so non-playing cards do no work.
  const coverForMood =
    memo.type === 'audio' && audioKind(memo) === 'music' && isActive(memo.id) ? src : null;
  const mood = useCoverMood(coverForMood);


  // ── Note ──
  if (memo.type === 'note') {
    const tintIdx = hashId(memo.id) % NOTE_TINTS.length;
    const body = memo.content_text || memo.content_raw || memo.description || '';
    return (
      <>
      <Chrome
        memo={memo}
        dragHandleProps={dragHandleProps}
        onDelete={handleDelete} onPin={handlePin}
        onOpen
        className="om-card-note"
        dataTint={tintIdx}
        confirmOverlay={confirmOverlay}
      >
        <div className="om-note-body">
          <h3 className="om-note-title">{memo.title}</h3>
          {body && <p className="om-note-text">{body}</p>}
        </div>
        <div className="om-meta" style={{ opacity: 0.62 }}>
          <div className="om-meta-left">
            <Icon name="fileText" size={11} />
            <span className="om-meta-domain">Note</span>
          </div>
          <span className="om-meta-date mono">
            {new Date(memo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </Chrome>
      </>
    );
  }

  // ── Image ──
  if (memo.type === 'image') {
    return (
      <>
        <Chrome
          memo={memo}
          dragHandleProps={dragHandleProps}
          onDelete={handleDelete}
          onPin={handlePin}
          bgSrc={src}
          className="om-card-image"
          onCardClick={showInLightbox}
          onOpen
          confirmOverlay={confirmOverlay}
        >
          <div className="om-image-frame" data-orient={imageOrient} style={{ background: heroBg, ...(imageAR ? { ['--card-ar']: imageAR } : {}) } as React.CSSProperties}>
            {src ? (
              <img
                draggable={false}
                src={src}
                alt=""
                className="om-media-img"
                onLoad={(e) => {
                  const ar = imgAspect(e.currentTarget);
                  setImageOrient(aspectToOrient(ar));
                  if (ar) setImageAR(ar);
                }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div className="om-hero-noise" />
            )}
            {memo.gallery && memo.gallery.length > 1 && (
              <div
                className="om-gallery-badge"
                aria-label={`${memo.gallery.length} images`}
                /* Top LEFT, not right: the card's hover tools occupy the top
                   right corner and covered the slide count the moment you
                   moved the mouse onto the card. */
                style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 500, padding: '3px 7px', borderRadius: 999, pointerEvents: 'none' }}
              >
                <Icon name="layers" size={12} />
                <span>{memo.gallery.length}</span>
              </div>
            )}
            <div className="om-min-hover" />
          </div>
          <div className="om-card-body tight">
            <h3 className="om-card-title">{memo.title}</h3>
            <Meta memo={memo} />
          </div>
          <div className="om-min-domain">
            <Icon name="image" size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memo.title}</span>
          </div>
        </Chrome>
        </>
    );
  }

  // ── Video ──
  if (memo.type === 'video') {
    const localVideo = memo.file_path ? `/api/memos/${memo.id}/file` : null;
    const canPlay = Boolean(localVideo || videoEmbedUrl(memo));
    return (
      <>
        <Chrome
          memo={memo}
          dragHandleProps={dragHandleProps}
          onDelete={handleDelete}
          onPin={handlePin}
          bgSrc={src}
          className="om-card-video"
          onCardClick={canPlay ? showInLightbox : undefined}
          onOpen
          confirmOverlay={confirmOverlay}
        >
          <div className="om-video-frame" data-orient={videoOrient} style={{ background: heroBg, ...(videoAR ? { ['--card-ar']: videoAR } : {}) } as React.CSSProperties}>
            {src ? (
              <img
                draggable={false}
                src={src}
                alt=""
                className="om-media-img"
                onLoad={(e) => {
                  const ar = imgAspect(e.currentTarget);
                  setVideoOrient(aspectToOrient(ar));
                  if (ar) setVideoAR(ar);
                }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div className="om-hero-noise" />
            )}
            <div className="om-min-hover" />
            <div className="om-play">
              <Icon name="play" size={16} stroke={0} style={{ fill: 'currentColor' }} />
            </div>
          </div>
          <div className="om-card-body">
            <h3 className="om-card-title">{memo.title}</h3>
            <Meta memo={memo} />
          </div>
          <div className="om-min-domain">
            <VideoSourceIcon memo={memo} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memo.title}</span>
          </div>
        </Chrome>
        </>
    );
  }

  // ── Document ──
  // A PDF carries a rendered page one as its cover (backend/core/pdf_thumb.py),
  // so the card shows the actual document. Every other document type, and any
  // PDF whose cover has not been backfilled yet, keeps the drawn page stack:
  // identical placeholders on a wall of cards are what this replaces.
  if (memo.type === 'document') {
    const pageCover = coverFailed ? null : mediaSrc(memo);
    return (
      <>
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen className="om-card-doc" confirmOverlay={confirmOverlay}>
        <div className={cn('om-doc-frame', pageCover && 'has-page')}>
          {pageCover ? (
            <img
              draggable={false}
              src={pageCover}
              alt=""
              className="om-doc-page-img"
              onError={() => setCoverFailed(true)}
            />
          ) : (
          <div className="om-doc-stack">
            <span className="om-doc-page" />
            <span className="om-doc-page" />
            <span className="om-doc-page front">
              <span className="om-doc-line" style={{ width: '70%' }} />
              <span className="om-doc-line" style={{ width: '90%' }} />
              <span className="om-doc-line" style={{ width: '60%' }} />
              <span className="om-doc-line" style={{ width: '80%' }} />
            </span>
          </div>
          )}
        </div>
        <div className="om-card-body">
          <h3 className="om-card-title">{memo.title}</h3>
          {memo.description && <p className="om-card-desc">{memo.description}</p>}
          <Meta memo={memo} />
        </div>
      </Chrome>
      </>
    );
  }

  // ── Generic file / code (no preview) — file-shape SVG with extension burned in ──
  if (memo.type === 'file' || memo.type === 'code') {
    const ext = (memo.title.includes('.') ? memo.title.split('.').pop()! : '').toLowerCase();
    return (
      <>
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen className="om-card-doc" confirmOverlay={confirmOverlay}>
        <div className="om-doc-frame">
          <FileBadge ext={ext} />
        </div>
        <div className="om-card-body">
          <h3 className="om-card-title">{memo.title}</h3>
          {memo.description && <p className="om-card-desc">{memo.description}</p>}
          <Meta memo={memo} />
        </div>
      </Chrome>
      </>
    );
  }

  // ── Audio ── play/pause drives the shared header player; clicking the card
  // body still opens the detail page (Chrome default).
  if (memo.type === 'audio') {
    const audioSrc = memo.file_path ? `/api/memos/${memo.id}/file` : null;
    const active = isActive(memo.id);
    const isThisPlaying = active && playing;
    const localizing = memo.localize_status === 'pending' || memo.localize_status === 'processing';
    // Music (uploaded/linked) gets the inline full-bleed player + aurora while
    // active; voice memos keep the waveform tile untouched (ADR-005).
    const isMusic = audioKind(memo) === 'music';
    // The full-bleed inline player + aurora are cover-centric, so they apply ONLY
    // to music WITH album art. Voice recordings (and any cover-less audio) keep the
    // classic waveform tile + centred play button — no full-bleed takeover, no
    // double play button. (ADR-005: voice stays on the old card.)
    const richMusic = isMusic && !!src;
    const playerOverlay = richMusic && active ? <CardMusicPlayer key="player" memo={memo} cover={src} mood={mood} /> : null;
    // Local file → play in the shared engine (sidebar player + inline). Remote
    // (yt-dlp, still downloading or streaming) → open the detail page, which
    // shows progress and plays/saves.
    const onPlayClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (audioSrc) {
        play({
          memoId: memo.id, title: memo.title, src: audioSrc,
          subtitle: memo.audio_artist || memo.source_domain || undefined,
          album: memo.audio_album || undefined,
          kind: audioKind(memo), cover: src, pinned: memo.pinned, liked: memo.liked,
        });
      } else {
        navigate(`/memo/${memo.id}`);
      }
    };
    return (
      <div className="om-card-aura-wrap">
        {/* Aurora glow behind the active MUSIC card — cover-tinted bloom, drifts,
            bleeds past the card edge (ADR-005). Cover-only (voice + cover-less
            audio never get it). The wrapper is unclipped so the halo escapes. */}
        {richMusic && active && (
          <div
            className={cn('om-card-aura', isThisPlaying && 'is-playing')}
            style={mood ? ({ ['--cov-rgb']: mood.rgb } as React.CSSProperties) : undefined}
            aria-hidden
          />
        )}
        <Chrome
          memo={memo}
          dragHandleProps={dragHandleProps}
          onDelete={handleDelete}
          onPin={handlePin}
          onOpen
          bgSrc={src}
          className={cn('om-card-audio', active && 'is-active', isMusic && 'is-music', richMusic && 'has-cover', isThisPlaying && 'is-playing')}
          confirmOverlay={confirmOverlay}
          playerOverlay={playerOverlay}
        >
          <div className="om-audio-frame">
            {src ? (
              <img
                draggable={false}
                src={src}
                alt=""
                className="om-media-img"
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <LiveWaveform memoId={memo.id} active={active} />
            )}
            <button
              className="om-play"
              onClick={onPlayClick}
              title={localizing ? 'Downloading…' : isThisPlaying ? 'Pause' : 'Play'}
              aria-label={localizing ? 'Downloading' : isThisPlaying ? 'Pause' : 'Play'}
            >
              <Icon name={isThisPlaying ? 'pause' : 'play'} size={16} stroke={0} style={{ fill: 'currentColor' }} />
            </button>
          </div>
          <div className="om-card-body">
            <h3 className="om-card-title has-kind-icon">
              <Icon name={isMusic ? 'music' : 'mic'} size={12} className="om-kind-icon" />
              <span className="om-kind-title-text">{memo.title}</span>
            </h3>
            <Meta memo={memo} />
          </div>
        </Chrome>
      </div>
    );
  }

  // ── Link / Article / fallback ──
  const domain = rootDomain(memo.source_domain);
  return (
    <>
    <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen bgSrc={src} className="om-card-link" confirmOverlay={confirmOverlay}>
      <div className="om-card-hero" style={{ background: heroBg }}>
        {src ? (
          <img
            draggable={false}
            src={src}
            alt=""
            className="om-media-img"
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <div className="om-hero-noise" />
        )}
      </div>
      {/* Normal mode body */}
      <div className="om-card-body">
        <h3 className="om-card-title">{memo.title}</h3>
        {memo.description && <p className="om-card-desc">{memo.description}</p>}
        <Meta memo={memo} />
      </div>
      {/* Minimal mode: always-visible domain pill */}
      <div className="om-min-domain">
        {memo.source_favicon ? (
          <img
            draggable={false}
            src={memo.source_favicon}
            alt=""
            width={12}
            height={12}
            style={{ borderRadius: 3, flexShrink: 0 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : null}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
      </div>
      {/* Minimal mode: hover reveals desc + tags + date.
          Domain pill stays in same position (rendered above as om-min-domain). */}
      <div className="om-min-hover">
        <p className="om-min-hover-desc">{memo.description || memo.title}</p>
        {memo.tags && memo.tags.length > 0 && (
          <div className="om-min-hover-tags">
            {memo.tags.slice(0, 8).map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </Chrome>
    </>
  );
}
