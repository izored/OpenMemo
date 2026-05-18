import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DraggableAttributes } from '@dnd-kit/core';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
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

function typeIcon(t: MemoType) {
  return (
    { note: 'fileText', link: 'link', article: 'globe', image: 'image', video: 'video', document: 'file', audio: 'mic' } as Record<string, string>
  )[t] || 'file';
}
function typeLabel(t: MemoType) {
  return (
    { note: 'Note', link: 'Link', article: 'Article', image: 'Image', video: 'Video', document: 'File', audio: 'Audio' } as Record<string, string>
  )[t] || 'Memo';
}

function mediaSrc(memo: Memo): string | null {
  if (memo.thumbnail_path) return memo.thumbnail_path;
  if (memo.type === 'image' && memo.file_path) return `/api/files/${memo.file_path}`;
  return null;
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
  bgSrc,
  children,
}: {
  memo: Memo;
  className?: string;
  style?: React.CSSProperties;
  dragHandleProps?: DragProps;
  onDelete: (e: React.MouseEvent) => void;
  bgSrc?: string | null;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div
      className={cn('om-card om-card-hover', className)}
      style={style}
      onClick={() => navigate(`/memo/${memo.id}`)}
    >
      {bgSrc && (
        <div className="om-card-dom" aria-hidden>
          <span style={{ backgroundImage: `url(${bgSrc})` }} />
        </div>
      )}
      <span
        {...(dragHandleProps?.attributes || {})}
        {...(dragHandleProps?.listeners || {})}
        className="om-drag"
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder / collection"
        aria-label="Drag handle"
      >
        <Icon name="grip" size={15} />
      </span>
      <div className="om-card-actions">
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
}

export function MemoCard({ memo, dragHandleProps }: CardProps) {
  const queryClient = useQueryClient();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${memo.title}"?`)) return;
    try {
      await memoApi.delete(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch {
      alert('Failed to delete memo');
    }
  };

  const src = mediaSrc(memo);
  const fallbackTint = TINT_FALLBACK[hashId(memo.id) % TINT_FALLBACK.length];
  const heroBg = `linear-gradient(135deg, ${fallbackTint} 0%, color-mix(in oklab, ${fallbackTint} 55%, #1a1a18) 100%)`;

  // ── Note ──
  if (memo.type === 'note') {
    const tint = NOTE_TINTS[hashId(memo.id) % NOTE_TINTS.length];
    const body = memo.content_text || memo.content_raw || memo.description || '';
    return (
      <Chrome
        memo={memo}
        dragHandleProps={dragHandleProps}
        onDelete={handleDelete}
        className="om-card-note"
        style={{ background: tint.bg, color: tint.text }}
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
    );
  }

  // ── Image ──
  if (memo.type === 'image') {
    return (
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} bgSrc={src} className="om-card-image">
        <div className="om-image-frame" style={{ background: src ? undefined : heroBg }}>
          {src ? (
            <img
              src={src}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : (
            <div className="om-hero-noise" />
          )}
        </div>
        <div className="om-card-body tight">
          <h3 className="om-card-title small">{memo.title}</h3>
          <Meta memo={memo} />
        </div>
      </Chrome>
    );
  }

  // ── Video ──
  if (memo.type === 'video') {
    return (
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} bgSrc={src} className="om-card-video">
        <div className="om-video-frame" style={{ background: src ? undefined : heroBg }}>
          {src ? (
            <img
              src={src}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : (
            <div className="om-hero-noise" />
          )}
          <div className="om-play">
            <Icon name="play" size={16} stroke={0} style={{ fill: 'currentColor' }} />
          </div>
        </div>
        <div className="om-card-body">
          <h3 className="om-card-title">{memo.title}</h3>
          <Meta memo={memo} />
        </div>
      </Chrome>
    );
  }

  // ── Document ──
  if (memo.type === 'document') {
    return (
      <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} className="om-card-doc">
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
    );
  }

  // ── Link / Article / Audio / fallback ──
  return (
    <Chrome memo={memo} dragHandleProps={dragHandleProps} onDelete={handleDelete} bgSrc={src} className="om-card-link">
      <div className="om-card-hero" style={{ background: src ? undefined : heroBg }}>
        {src ? (
          <img
            src={src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <div className="om-hero-noise" />
        )}
      </div>
      <div className="om-card-body">
        <h3 className="om-card-title">{memo.title}</h3>
        {memo.description && <p className="om-card-desc">{memo.description}</p>}
        <Meta memo={memo} />
      </div>
    </Chrome>
  );
}
