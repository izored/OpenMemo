import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Globe,
  Image,
  Video,
  Mic,
  File,
  Link2,
  MoreHorizontal,
  FolderPlus,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Memo, MemoType } from '@/types';

const typeConfig: Record<MemoType, { icon: any; color: string; label: string }> = {
  note: { icon: FileText, color: '#FEF3C7', label: 'Note' },
  article: { icon: Globe, color: '#E0F2FE', label: 'Article' },
  video: { icon: Video, color: '#FEE2E2', label: 'Video' },
  image: { icon: Image, color: '#F3E8FF', label: 'Image' },
  audio: { icon: Mic, color: '#D1FAE5', label: 'Audio' },
  document: { icon: File, color: '#F3F4F6', label: 'Document' },
  link: { icon: Link2, color: '#E0F2FE', label: 'Link' },
};

interface MemoCardProps {
  memo: Memo;
  view?: 'grid' | 'list';
}

export function MemoCard({ memo, view = 'grid' }: MemoCardProps) {
  const navigate = useNavigate();
  const config = typeConfig[memo.type] || typeConfig.note;
  const Icon = config.icon;

  const formattedDate = new Date(memo.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  if (view === 'list') {
    return (
      <div
        onClick={() => navigate(`/memo/${memo.id}`)}
        className="flex items-center gap-4 px-4 py-3 hover:bg-[#F3F4F6] rounded-lg cursor-pointer group transition-colors"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: config.color }}
        >
          <Icon size={16} className="text-[#6B7280]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1F2937] truncate">{memo.title}</p>
          {memo.description && (
            <p className="text-xs text-[#6B7280] truncate mt-0.5">{memo.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[#9CA3AF]">
          {memo.source_domain && <span>{memo.source_domain}</span>}
          <span>{formattedDate}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => navigate(`/memo/${memo.id}`)}
      className="bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-all cursor-pointer group overflow-hidden"
    >
      {/* Thumbnail */}
      {memo.thumbnail_path ? (
        <div className="h-32 bg-[#F3F4F6] overflow-hidden">
          <img
            src={memo.thumbnail_path}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      ) : (
        <div
          className="h-24 flex items-center justify-center"
          style={{ backgroundColor: config.color }}
        >
          <Icon size={32} className="text-[#6B7280] opacity-50" />
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        <h3 className="text-sm font-medium text-[#1F2937] line-clamp-2 leading-snug">
          {memo.title}
        </h3>
        {memo.description && (
          <p className="text-xs text-[#6B7280] line-clamp-1 mt-1">{memo.description}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#F3F4F6]">
          <div className="flex items-center gap-1.5">
            {memo.source_favicon && (
              <img src={memo.source_favicon} alt="" className="w-3.5 h-3.5 rounded" />
            )}
            <span className="text-xs text-[#9CA3AF] truncate max-w-[80px]">
              {memo.source_domain || config.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: config.color, color: '#6B7280' }}
            >
              {config.label}
            </span>
            <span className="text-[10px] text-[#9CA3AF]">{formattedDate}</span>
          </div>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-[#F3F4F6]"
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-[#F3F4F6]"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}
