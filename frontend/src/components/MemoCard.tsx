import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Globe,
  Image,
  Video,
  Mic,
  File,
  Link2,
  Play,
  GripVertical,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { memoApi } from '@/lib/api';
import type { Memo, MemoType } from '@/types';

const typeConfig: Record<
  MemoType,
  { icon: any; label: string; cssBg: string; cssText: string }
> = {
  note: { icon: FileText, label: 'Notes', cssBg: 'var(--color-type-note-bg)', cssText: 'var(--color-type-note-text)' },
  article: { icon: Globe, label: 'Article', cssBg: 'var(--color-type-article-bg)', cssText: 'var(--color-type-article-text)' },
  video: { icon: Video, label: 'Video', cssBg: 'var(--color-type-video-bg)', cssText: 'var(--color-type-video-text)' },
  image: { icon: Image, label: 'Image', cssBg: 'var(--color-type-image-bg)', cssText: 'var(--color-type-image-text)' },
  audio: { icon: Mic, label: 'Audio', cssBg: 'var(--color-type-audio-bg)', cssText: 'var(--color-type-audio-text)' },
  document: { icon: File, label: 'File', cssBg: 'var(--color-type-document-bg)', cssText: 'var(--color-type-document-text)' },
  link: { icon: Link2, label: 'Link', cssBg: 'var(--color-type-link-bg)', cssText: 'var(--color-type-link-text)' },
};

interface MemoCardProps {
  memo: Memo;
  dragHandleProps?: {
    attributes: Record<string, any>;
    listeners?: Record<string, any>;
  };
}

export function MemoCard({ memo, dragHandleProps }: MemoCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const config = typeConfig[memo.type] || typeConfig.note;
  const Icon = config.icon;

  const formattedDate = new Date(memo.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const handleClick = () => {
    navigate(`/memo/${memo.id}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${memo.title}"?`)) return;
    try {
      await memoApi.delete(memo.id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch (err) {
      alert('Failed to delete memo');
    }
  };

  const DragHandle = () => (
    <span
      {...(dragHandleProps?.attributes || {})}
      {...(dragHandleProps?.listeners || {})}
      className="absolute top-3 left-3 z-10 p-2 rounded-lg bg-[var(--color-dark)]/80 hover:bg-[var(--color-dark)] text-[var(--color-bg)] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
      onClick={(e) => e.stopPropagation()}
      title="Drag to collection"
    >
      <GripVertical size={14} />
    </span>
  );

  const DeleteButton = () => (
    <button
      onClick={handleDelete}
      className={cn(
        'absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-[var(--color-brand)]/90 hover:bg-[var(--color-brand)] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg',
        'delay-[3000ms] duration-300'
      )}
      title="Delete memo"
    >
      <X size={13} strokeWidth={3} />
    </button>
  );

  // ─── Sticky Note ───
  if (memo.type === 'note') {
    return (
      <div
        onClick={handleClick}
        className="group relative rounded-[28px] p-8 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 min-h-[320px] flex flex-col"
        style={{ backgroundColor: config.cssBg }}
      >
        <DragHandle />
        <DeleteButton />
        <h3 className="text-lg font-bold line-clamp-3 leading-snug mb-4 pr-6" style={{ color: config.cssText }}>
          {memo.title}
        </h3>
        {(memo.content_text || memo.content_raw || memo.description) && (
          <p className="text-[15px] line-clamp-5 leading-relaxed opacity-75 mb-6" style={{ color: config.cssText }}>
            {memo.content_text || memo.content_raw || memo.description}
          </p>
        )}
        <div className="mt-auto pt-5 border-t border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon size={16} style={{ color: config.cssText }} />
            <span className="text-sm font-semibold" style={{ color: config.cssText }}>
              {config.label}
            </span>
          </div>
          <span className="text-[13px] opacity-50 font-medium" style={{ color: config.cssText }}>
            {formattedDate}
          </span>
        </div>
      </div>
    );
  }

  // ─── Image Card ───
  if (memo.type === 'image') {
    return (
      <div
        onClick={handleClick}
        className="group relative bg-[var(--color-bg-card)] rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
      >
        <DragHandle />
        <DeleteButton />
        {memo.thumbnail_path || memo.file_path ? (
          <div className="aspect-square overflow-hidden">
            <img
              src={memo.thumbnail_path || `/api/files/${memo.file_path}`}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        ) : (
          <div className="aspect-square flex items-center justify-center" style={{ backgroundColor: config.cssBg }}>
            <Icon size={64} className="text-[var(--color-text-muted)] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[var(--color-text)] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          <div className="flex items-center justify-between mt-6">
            <div className="flex items-center gap-2.5">
              <Icon size={16} className="text-[var(--color-text-muted)]" />
              <span className="text-sm text-[var(--color-text-muted)] font-semibold">{config.label}</span>
            </div>
            <span className="text-[13px] text-[var(--color-text-muted)] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Video Card ───
  if (memo.type === 'video') {
    return (
      <div
        onClick={handleClick}
        className="group relative bg-[var(--color-bg-card)] rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
      >
        <DragHandle />
        <DeleteButton />
        {memo.thumbnail_path ? (
          <div className="aspect-[4/3] overflow-hidden relative">
            <img
              src={memo.thumbnail_path}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center group-hover:bg-black/30 transition-colors">
              <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
                <Play size={26} className="text-[var(--color-text)] ml-0.5" fill="currentColor" />
              </div>
            </div>

          </div>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center relative" style={{ backgroundColor: config.cssBg }}>
            <Icon size={64} className="text-[var(--color-text-muted)] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[var(--color-text)] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-3">
              {memo.source_favicon ? (
                <img src={memo.source_favicon} alt="" className="w-5 h-5 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <Icon size={17} className="text-[var(--color-text-muted)]" />
              )}
              <span className="text-[15px] text-[var(--color-text-secondary)] font-semibold truncate max-w-[150px]">
                {memo.source_domain || config.label}
              </span>
            </div>
            <span className="text-[13px] text-[var(--color-text-muted)] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Document Card ───
  if (memo.type === 'document') {
    return (
      <div
        onClick={handleClick}
        className="group relative bg-[var(--color-bg-card)] rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
      >
        <DragHandle />
        <DeleteButton />
        {memo.thumbnail_path ? (
          <div className="aspect-[4/3] overflow-hidden bg-[var(--color-bg-hover)]">
            <img src={memo.thumbnail_path} alt="" className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center" style={{ backgroundColor: config.cssBg }}>
            <Icon size={64} className="text-[var(--color-text-muted)] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[var(--color-text)] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          {memo.description && (
            <p className="text-[15px] text-[var(--color-text-secondary)] line-clamp-2 mt-3 leading-relaxed">
              {memo.description}
            </p>
          )}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-2.5">
              <Icon size={16} className="text-[var(--color-text-muted)]" />
              <span className="text-sm text-[var(--color-text-muted)] font-semibold">{config.label}</span>
            </div>
            <span className="text-[13px] text-[var(--color-text-muted)] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Link / Article / Audio / Fallback ───
  return (
    <div
      onClick={handleClick}
      className="group relative bg-[var(--color-bg-card)] rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
    >
      <DragHandle />
      <DeleteButton />
      {memo.thumbnail_path ? (
        <div className="aspect-[4/3] overflow-hidden relative">
          <img
            src={memo.thumbnail_path}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />

        </div>
      ) : (
        <div className="aspect-[4/3] flex items-center justify-center relative" style={{ backgroundColor: config.cssBg }}>
          {memo.source_favicon ? (
            <img src={memo.source_favicon} alt="" className="w-20 h-20 rounded-2xl"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <Icon size={64} className="text-[var(--color-text-muted)] opacity-20" />
          )}
        </div>
      )}

      <div className="p-7">
        <h3 className="text-[17px] font-bold text-[var(--color-text)] line-clamp-2 leading-snug">
          {memo.title}
        </h3>
        {memo.description && (
          <p className="text-[15px] text-[var(--color-text-secondary)] line-clamp-2 mt-3 leading-relaxed">
            {memo.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-7 pt-4 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            {memo.source_favicon ? (
              <img src={memo.source_favicon} alt="" className="w-5 h-5 rounded-full"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <Icon size={17} className="text-[var(--color-text-muted)]" />
            )}
            <span className="text-[15px] text-[var(--color-text-secondary)] font-semibold truncate max-w-[150px]">
              {memo.source_domain || config.label}
            </span>
          </div>
          <span className="text-[13px] text-[var(--color-text-muted)] font-medium">{formattedDate}</span>
        </div>
      </div>
    </div>
  );
}
