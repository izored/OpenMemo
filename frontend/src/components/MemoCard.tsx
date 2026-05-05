import { useNavigate } from 'react-router-dom';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Memo, MemoType } from '@/types';

const typeConfig: Record<
  MemoType,
  { icon: any; color: string; label: string; bg: string }
> = {
  note: { icon: FileText, color: '#92400E', label: 'Notes', bg: '#FEF3C7' },
  article: { icon: Globe, color: '#1E40AF', label: 'Article', bg: '#EFF6FF' },
  video: { icon: Video, color: '#991B1B', label: 'Video', bg: '#FEF2F2' },
  image: { icon: Image, color: '#6B21A8', label: 'Image', bg: '#FAF5FF' },
  audio: { icon: Mic, color: '#065F46', label: 'Audio', bg: '#ECFDF5' },
  document: { icon: File, color: '#374151', label: 'File', bg: '#F9FAFB' },
  link: { icon: Link2, color: '#1E40AF', label: 'Link', bg: '#EFF6FF' },
};

interface MemoCardProps {
  memo: Memo;
}

export function MemoCard({ memo }: MemoCardProps) {
  const navigate = useNavigate();
  const config = typeConfig[memo.type] || typeConfig.note;
  const Icon = config.icon;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: memo.id,
  });

  const dragStyle = transform
    ? { transform: CSS.Transform.toString(transform) }
    : undefined;

  const formattedDate = new Date(memo.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const handleClick = () => {
    navigate(`/memo/${memo.id}`);
  };

  const DragHandle = () => (
    <span
      {...listeners}
      {...attributes}
      className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/10 hover:bg-black/20 text-white/80 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      title="Drag to collection"
    >
      <GripVertical size={14} />
    </span>
  );

  // ─── Sticky Note ───
  if (memo.type === 'note') {
    return (
      <div
        ref={setNodeRef}
        onClick={handleClick}
        className="group relative rounded-[28px] p-8 cursor-pointer transition-all duration-300 hover:shadow-xl hover:-translate-y-1 min-h-[320px] flex flex-col"
        style={{ backgroundColor: config.bg, ...dragStyle, opacity: isDragging ? 0.3 : undefined }}
      >
        <DragHandle />
        <h3 className="text-lg font-bold line-clamp-3 leading-snug mb-4 pr-6" style={{ color: config.color }}>
          {memo.title}
        </h3>
        {memo.content_text && (
          <p className="text-[15px] line-clamp-5 leading-relaxed opacity-75 mb-6" style={{ color: config.color }}>
            {memo.content_text}
          </p>
        )}
        {!memo.content_text && memo.description && (
          <p className="text-[15px] line-clamp-5 leading-relaxed opacity-75 mb-6" style={{ color: config.color }}>
            {memo.description}
          </p>
        )}
        <div className="mt-auto pt-5 border-t border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon size={16} style={{ color: config.color }} />
            <span className="text-sm font-semibold" style={{ color: config.color }}>
              {config.label}
            </span>
          </div>
          <span className="text-[13px] opacity-50 font-medium" style={{ color: config.color }}>
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
        ref={setNodeRef}
        onClick={handleClick}
        className="group relative bg-white rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
        style={{ ...dragStyle, opacity: isDragging ? 0.3 : undefined }}
      >
        <DragHandle />
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
          <div className="aspect-square flex items-center justify-center" style={{ backgroundColor: config.bg }}>
            <Icon size={64} className="text-[#646464] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[#202020] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          <div className="flex items-center justify-between mt-6">
            <div className="flex items-center gap-2.5">
              <Icon size={16} className="text-[#8d8d8d]" />
              <span className="text-sm text-[#8d8d8d] font-semibold">{config.label}</span>
            </div>
            <span className="text-[13px] text-[#8d8d8d] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Video Card ───
  if (memo.type === 'video') {
    return (
      <div
        ref={setNodeRef}
        onClick={handleClick}
        className="group relative bg-white rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
        style={{ ...dragStyle, opacity: isDragging ? 0.3 : undefined }}
      >
        <DragHandle />
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
                <Play size={26} className="text-[#202020] ml-0.5" fill="#202020" />
              </div>
            </div>

          </div>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center relative" style={{ backgroundColor: config.bg }}>
            <Icon size={64} className="text-[#646464] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[#202020] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#f0f0f0]">
            <div className="flex items-center gap-3">
              {memo.source_favicon ? (
                <img src={memo.source_favicon} alt="" className="w-5 h-5 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <Icon size={17} className="text-[#8d8d8d]" />
              )}
              <span className="text-[15px] text-[#646464] font-semibold truncate max-w-[150px]">
                {memo.source_domain || config.label}
              </span>
            </div>
            <span className="text-[13px] text-[#8d8d8d] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Document Card ───
  if (memo.type === 'document') {
    return (
      <div
        ref={setNodeRef}
        onClick={handleClick}
        className="group relative bg-white rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
        style={{ ...dragStyle, opacity: isDragging ? 0.3 : undefined }}
      >
        <DragHandle />
        {memo.thumbnail_path ? (
          <div className="aspect-[4/3] overflow-hidden bg-[#f8f8f8]">
            <img src={memo.thumbnail_path} alt="" className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        ) : (
          <div className="aspect-[4/3] flex items-center justify-center" style={{ backgroundColor: config.bg }}>
            <Icon size={64} className="text-[#646464] opacity-20" />
          </div>
        )}
        <div className="p-7">
          <h3 className="text-[17px] font-bold text-[#202020] line-clamp-2 leading-snug">
            {memo.title}
          </h3>
          {memo.description && (
            <p className="text-[15px] text-[#646464] line-clamp-2 mt-3 leading-relaxed">
              {memo.description}
            </p>
          )}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#f0f0f0]">
            <div className="flex items-center gap-2.5">
              <Icon size={16} className="text-[#8d8d8d]" />
              <span className="text-sm text-[#8d8d8d] font-semibold">{config.label}</span>
            </div>
            <span className="text-[13px] text-[#8d8d8d] font-medium">{formattedDate}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Link / Article / Audio / Fallback ───
  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className="group relative bg-white rounded-[28px] overflow-hidden cursor-pointer shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
      style={{ ...dragStyle, opacity: isDragging ? 0.3 : undefined }}
    >
      <DragHandle />
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
        <div className="aspect-[4/3] flex items-center justify-center relative" style={{ backgroundColor: config.bg }}>
          {memo.source_favicon ? (
            <img src={memo.source_favicon} alt="" className="w-20 h-20 rounded-2xl"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <Icon size={64} className="text-[#646464] opacity-20" />
          )}
        </div>
      )}

      <div className="p-7">
        <h3 className="text-[17px] font-bold text-[#202020] line-clamp-2 leading-snug">
          {memo.title}
        </h3>
        {memo.description && (
          <p className="text-[15px] text-[#646464] line-clamp-2 mt-3 leading-relaxed">
            {memo.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-7 pt-4 border-t border-[#f0f0f0]">
          <div className="flex items-center gap-3">
            {memo.source_favicon ? (
              <img src={memo.source_favicon} alt="" className="w-5 h-5 rounded-full"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <Icon size={17} className="text-[#8d8d8d]" />
            )}
            <span className="text-[15px] text-[#646464] font-semibold truncate max-w-[150px]">
              {memo.source_domain || config.label}
            </span>
          </div>
          <span className="text-[13px] text-[#8d8d8d] font-medium">{formattedDate}</span>
        </div>
      </div>
    </div>
  );
}
