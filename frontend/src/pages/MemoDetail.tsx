import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Share2,
  MessageSquare,
  Tag,
  MoreHorizontal,
  Sparkles,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { memoApi } from '@/lib/api';
import { AskMemoPanel } from '@/components/AskMemoPanel';
import ReactMarkdown from 'react-markdown';

export function MemoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  const { data: memo, isLoading } = useQuery({
    queryKey: ['memo', id],
    queryFn: () => memoApi.get(id!),
    enabled: !!id,
  });

  const { data: related = [] } = useQuery({
    queryKey: ['memo-related', id],
    queryFn: () => memoApi.related(id!),
    enabled: !!id,
  });

  const handleGenerateSummary = async () => {
    if (!id) return;
    setGeneratingSummary(true);
    try {
      await memoApi.summary(id);
      queryClient.invalidateQueries({ queryKey: ['memo', id] });
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingSummary(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[#D97706] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[#6B7280]">Memo not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Content pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"
            >
              <ArrowLeft size={18} className="text-[#6B7280]" />
            </button>
            <span className="text-sm text-[#9CA3AF]">{memo.type}</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-lg hover:bg-[#F3F4F6]">
              <Share2 size={16} className="text-[#6B7280]" />
            </button>
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`p-2 rounded-lg ${chatOpen ? 'bg-[#FEF3C7] text-[#D97706]' : 'hover:bg-[#F3F4F6] text-[#6B7280]'}`}
            >
              <MessageSquare size={16} />
            </button>
            <button className="p-2 rounded-lg hover:bg-[#F3F4F6]">
              <Tag size={16} className="text-[#6B7280]" />
            </button>
            <button className="p-2 rounded-lg hover:bg-[#F3F4F6]">
              <MoreHorizontal size={16} className="text-[#6B7280]" />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {/* Title & meta */}
            <h1 className="text-2xl font-semibold text-[#1F2937] mb-2">{memo.title}</h1>
            <div className="flex items-center gap-3 text-sm text-[#6B7280] mb-6">
              <span>{new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              {memo.source_domain && (
                <>
                  <span>•</span>
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-[#D97706]"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" className="w-4 h-4 rounded" />}
                    {memo.source_domain}
                    <ExternalLink size={12} />
                  </a>
                </>
              )}
              {memo.tags?.length > 0 && (
                <>
                  <span>•</span>
                  <div className="flex gap-1">
                    {memo.tags.map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-[#F3F4F6] rounded text-xs">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* AI Summary */}
            {memo.ai_summary ? (
              <div className="mb-6 p-4 rounded-xl border-2 border-[#D97706]/30 bg-[#FFFBEB]">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} className="text-[#D97706]" />
                  <span className="text-sm font-medium text-[#92400E]">AI Summary</span>
                </div>
                <div className="text-sm text-[#78350F] prose prose-sm max-w-none">
                  <ReactMarkdown>{memo.ai_summary}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerateSummary}
                disabled={generatingSummary}
                className="mb-6 flex items-center gap-2 px-4 py-2 border border-[#D97706] text-[#D97706] rounded-lg text-sm hover:bg-[#FEF3C7] disabled:opacity-50"
              >
                {generatingSummary ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Generate AI Summary
              </button>
            )}

            {/* Thumbnail / Image */}
            {memo.type === 'image' && memo.file_path && (
              <div className="mb-6 rounded-xl overflow-hidden">
                <img src={`/files/${memo.file_path}`} alt={memo.title} className="w-full" />
              </div>
            )}

            {memo.type === 'video' && memo.source_url && (
              <div className="mb-6 aspect-video rounded-xl overflow-hidden bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${new URL(memo.source_url).searchParams.get('v') || ''}`}
                  className="w-full h-full"
                  allowFullScreen
                />
              </div>
            )}

            {/* Content body */}
            {memo.content_text && (
              <div className="prose prose-sm max-w-none text-[#374151]">
                <ReactMarkdown>{memo.content_raw || memo.content_text}</ReactMarkdown>
              </div>
            )}

            {/* Related memos */}
            {related.length > 0 && (
              <div className="mt-10 pt-6 border-t border-[#E5E7EB]">
                <h3 className="text-sm font-medium text-[#6B7280] mb-3">Related Memos</h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {related.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/memo/${r.id}`)}
                      className="flex-shrink-0 w-48 p-3 border border-[#E5E7EB] rounded-xl hover:bg-[#F3F4F6] text-left"
                    >
                      <p className="text-sm font-medium text-[#1F2937] line-clamp-2">{r.title}</p>
                      <p className="text-xs text-[#9CA3AF] mt-1">{r.source_domain || r.type}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat pane */}
      {chatOpen && (
        <div className="w-96 border-l border-[#E5E7EB] flex flex-col">
          <AskMemoPanel memoId={id!} />
        </div>
      )}
    </div>
  );
}
