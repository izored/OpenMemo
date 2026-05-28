import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DraggableAttributes } from '@dnd-kit/core';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
import { mediaSrc, youtubeEmbed } from '@/lib/media';
import { useAppStore } from '@/stores/appStore';
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

interface DragProps {
  attributes: DraggableAttributes;
  listeners?: Record<string, unknown>;
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
  onOpen?: (e: React.MouseEvent) => void;
}) {
  const navigate = useNavigate();
  const handleClick = () => {
    if (onCardClick) onCardClick();
    else navigate(`/memo/${memo.id}`);
  };
  return (
    <div
      {...(dragHandleProps?.attributes || {})}
      {...(dragHandleProps?.listeners || {})}
      className={cn('om-card om-card-hover', className)}
      style={style}
      data-tint={dataTint !== undefined ? String(dataTint) : undefined}
      onClick={handleClick}
    >
      {bgSrc && (
        <div className="om-card-dom" aria-hidden>
          <span style={{ backgroundImage: `url(${bgSrc})` }} />
        </div>
      )}
      <div className="om-card-actions">
        {onOpen && (
          <button className="om-action" onClick={onOpen} title="Open memo page" aria-label="Open memo">
            <Icon name="arrowUpRight" size={14} />
          </button>
        )}
        <button
          className={cn('om-action', memo.pinned && 'pinned')}
          onClick={onPin}
          title={memo.pinned ? 'Unpin' : 'Pin to sidebar'}
        >
          <Icon name="pin" size={14} />
        </button>
        <button className="om-action" onClick={onDelete} title="Delete">
          <Icon name="x" size={15} />
        </button>
      </div>
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
  const [imageOrient, setImageOrient] = React.useState<'landscape' | 'portrait'>('landscape');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const showInLightbox = () => {
    const group = lightboxGroup && lightboxGroup.length ? lightboxGroup : [memo];
    const idx = group.findIndex((m) => m.id === memo.id);
    openLightbox(group, idx >= 0 ? idx : 0);
  };

  React.useEffect(() => {
    if (!confirmDeleteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirmDeleteOpen]);

  const goDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/memo/${memo.id}`);
  };

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false);
    try {
      await memoApi.delete(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch {
      alert('Failed to delete memo');
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

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

  const confirmModal = confirmDeleteOpen ? (
    <div
      className="om-confirm-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { e.stopPropagation(); setConfirmDeleteOpen(false); }}
    >
      <div className="om-confirm" onClick={(e) => e.stopPropagation()}>
        <h3 className="om-confirm-title">Delete memo?</h3>
        <p className="om-confirm-body">
          <strong>{memo.title}</strong> will be permanently removed. This cannot be undone.
        </p>
        <div className="om-confirm-actions">
          <button className="om-confirm-btn" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
          <button className="om-confirm-btn danger" onClick={confirmDelete} autoFocus>Delete</button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Note ──
  if (memo.type === 'note') {
    const tintIdx = hashId(memo.id) % NOTE_TINTS.length;
    const tint = NOTE_TINTS[tintIdx];
    const body = memo.content_text || memo.content_raw || memo.description || '';
    return (
      <>
      <Chrome
        memo={memo}
        dragHandleProps={dragHandleProps}
        onDelete={handleDelete} onPin={handlePin}
        onOpen={goDetail}
        className="om-card-note"
        style={{ background: tint.bg, color: tint.text }}
        dataTint={tintIdx}
      >
        <div className="om-note-body">
          <h3 className="om-note-title">{memo.title}</h3>
          {body && <p className="om-note-text">{body}</p>}
        </div>
        <div className="om-meta" style={{ color: tint.text, opacity: 0.62 }}>
          <div className="om-meta-left">
            <Icon name="fileText" size={11} />
            <span className="om-meta-domain">Note</span>
          </div>
          <span className="om-meta-date mono">
            {new Date(memo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </Chrome>
      {confirmModal}
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
          onOpen={goDetail}
        >
          <div className="om-image-frame" data-orient={imageOrient} style={{ background: heroBg }}>
            {src ? (
              <img
                src={src}
                alt=""
                className="om-media-img"
                onLoad={(e) => {
                  const img = e.target as HTMLImageElement;
                  setImageOrient(img.naturalHeight > img.naturalWidth ? 'portrait' : 'landscape');
                }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
              />
            ) : (
              <div className="om-hero-noise" />
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
        {confirmModal}
      </>
    );
  }

  // ── Video ──
  if (memo.type === 'video') {
    const localVideo = memo.file_path ? `/api/memos/${memo.id}/file` : null;
    const ytEmbed = youtubeEmbed(memo.source_url);
    const canPlay = localVideo || ytEmbed;
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
          onOpen={goDetail}
        >
          <div className="om-video-frame" style={{ background: heroBg }}>
            {src ? (
              <img
                src={src}
                alt=""
                className="om-media-img"
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
            <Icon name="video" size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{memo.title}</span>
          </div>
        </Chrome>
        {confirmModal}
      </>
    );
  }

  // ── Document ──
  if (memo.type === 'document') {
    return (
      <>
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen={goDetail} className="om-card-doc">
        <div className="om-doc-frame">
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
        </div>
        <div className="om-card-body">
          <h3 className="om-card-title">{memo.title}</h3>
          {memo.description && <p className="om-card-desc">{memo.description}</p>}
          <Meta memo={memo} />
        </div>
      </Chrome>
      {confirmModal}
      </>
    );
  }

  // ── Generic file / code (no preview) — file-shape SVG with extension burned in ──
  if (memo.type === 'file' || memo.type === 'code') {
    const ext = (memo.title.includes('.') ? memo.title.split('.').pop()! : '').toLowerCase();
    return (
      <>
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen={goDetail} className="om-card-doc">
        <div className="om-doc-frame">
          <FileBadge ext={ext} />
        </div>
        <div className="om-card-body">
          <h3 className="om-card-title">{memo.title}</h3>
          {memo.description && <p className="om-card-desc">{memo.description}</p>}
          <Meta memo={memo} />
        </div>
      </Chrome>
      {confirmModal}
      </>
    );
  }

  // ── Link / Article / Audio / fallback ──
  const domain = rootDomain(memo.source_domain);
  return (
    <>
    <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} onPin={handlePin} onOpen={goDetail} bgSrc={src} className="om-card-link">
      <div className="om-card-hero" style={{ background: heroBg }}>
        {src ? (
          <img
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
    {confirmModal}
    </>
  );
}
