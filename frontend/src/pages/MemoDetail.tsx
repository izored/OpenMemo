import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  MessageSquare,
  Sparkles,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { memoApi } from '@/lib/api';
import { AskMemoPanel } from '@/components/AskMemoPanel';
import ReactMarkdown from 'react-markdown';

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v');
    }
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1);
    }
  } catch {
    return null;
  }
  return null;
}

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
        <div className="w-8 h-8 border-2 border-[#ea2804] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[#646464]">Memo not found</p>
      </div>
    );
  }

  const youtubeId = memo.type === 'video' && memo.source_url ? getYouTubeVideoId(memo.source_url) : null;

  return (
    <div className="h-full flex">
      {/* Content pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 pl-14 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-full hover:bg-[#f5f5f5] transition-colors"
            >
              <ArrowLeft size={18} className="text-[#646464]" />
            </button>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#8d8d8d]">{memo.type}</span>
          </div>
          <div className="flex items-center gap-1">
            {memo.source_url && (
              <a
                href={memo.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#646464] hover:text-[#202020] hover:bg-[#f5f5f5] rounded-full transition-colors"
              >
                <ExternalLink size={14} />
                Open Original
              </a>
            )}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`p-2 rounded-full transition-colors ${chatOpen ? 'bg-[#FEE4E0] text-[#ea2804]' : 'hover:bg-[#f5f5f5] text-[#646464]'}`}
            >
              <MessageSquare size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {/* Title & meta */}
            <h1 className="text-2xl font-bold text-[#202020] mb-2 tracking-tight">{memo.title}</h1>
            <div className="flex items-center gap-3 text-sm text-[#646464] mb-6">
              <span className="font-mono text-[11px]">{new Date(memo.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              {memo.source_domain && (
                <>
                  <span>•</span>
                  <a
                    href={memo.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:text-[#ea2804] transition-colors link-dotted"
                  >
                    {memo.source_favicon && <img src={memo.source_favicon} alt="" className="w-4 h-4 rounded-full" />}
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
                      <span key={tag} className="px-2 py-0.5 bg-[#f5f5f5] rounded-full text-[11px] font-semibold uppercase tracking-wide">{tag}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* AI Summary */}
            {memo.ai_summary ? (
              <div className="mb-6 p-5 rounded-2xl border border-[#ea2804]/20 bg-[#FFF5F3]">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} className="text-[#ea2804]" />
                  <span className="text-sm font-semibold text-[#202020]">AI Summary</span>
                </div>
                <div className="text-sm text-[#202020] prose prose-sm max-w-none">
                  <ReactMarkdown>{memo.ai_summary}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerateSummary}
                disabled={generatingSummary}
                className="mb-6 flex items-center gap-2 px-5 py-2 border border-[#202020] text-[#202020] rounded-full text-sm font-semibold hover:bg-[#f5f5f5] disabled:opacity-40 transition-colors"
              >
                {generatingSummary ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Generate AI Summary
              </button>
            )}

            {/* Thumbnail / Image */}
            {memo.type === 'image' && memo.file_path && (
              <div className="mb-6 rounded-2xl overflow-hidden border border-[#e5e5e5]">
                <img src={`/api/files/${memo.file_path}`} alt={memo.title} className="w-full" />
              </div>
            )}

            {youtubeId && (
              <div className="mb-6 aspect-video rounded-2xl overflow-hidden bg-[#202020]">
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}`}
                  className="w-full h-full"
                  allowFullScreen
                  title={memo.title}
                />
              </div>
            )}

            {/* Content body */}
            {memo.content_text && (
              <div className="prose prose-sm max-w-none text-[#202020]">
                <ReactMarkdown components={{
                  code: ({node, inline, className, children, ...props}: any) => (
                    inline ? (
                      <code className="bg-[#24292e] text-white px-1 py-0.5 rounded text-[11px] font-mono" {...props}>{children}</code>
                    ) : (
                      <pre className="bg-[#24292e] text-white p-4 rounded-xl overflow-x-auto font-mono text-[12px] my-3" {...props}>
                        <code>{children}</code>
                      </pre>
                    )
                  )
                }}>{memo.content_raw || memo.content_text}</ReactMarkdown>
              </div>
            )}

            {/* Related memos */}
            {related.length > 0 && (
              <div className="mt-10 pt-6 border-t border-[#e5e5e5]">
                <h3 className="text-xs font-semibold text-[#8d8d8d] uppercase tracking-wider mb-3">Related Memos</h3>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {related.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => navigate(`/memo/${r.id}`)}
                      className="flex-shrink-0 w-48 p-3 border border-[#e5e5e5] rounded-2xl hover:border-[#202020] text-left transition-colors"
                    >
                      <p className="text-sm font-semibold text-[#202020] line-clamp-2">{r.title}</p>
                      <p className="text-[11px] text-[#8d8d8d] mt-1 font-mono">{r.source_domain || r.type}</p>
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
        <div className="w-96 border-l border-[#e5e5e5] flex flex-col">
          <AskMemoPanel memoId={id!} />
        </div>
      )}
    </div>
  );
}
