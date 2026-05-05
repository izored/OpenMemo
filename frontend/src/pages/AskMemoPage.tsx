import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Bot, User, Loader2, Sparkles, Globe } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { chatApi, systemApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
}

export function AskMemoPage() {
  const { chatModel, setChatModel } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: modelsData } = useQuery({
    queryKey: ['models'],
    queryFn: systemApi.models,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', sources: [] };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const resp = await chatApi.stream({
        query: userMsg.content,
        session_id: sessionId || undefined,
        model: chatModel,
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const json = line.slice(6);
            try {
              const data = JSON.parse(json);
              if (data.type === 'token') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += data.data;
                  }
                  return [...updated];
                });
              } else if (data.type === 'sources') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.sources = data.data;
                  }
                  return [...updated];
                });
              } else if (data.type === 'done') {
                setSessionId(data.session_id);
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.content = 'Error: ' + (e.message || 'Failed to get response');
        }
        return [...updated];
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-[#D97706]" />
          <h1 className="text-xl font-semibold text-[#1F2937]">AskMemo</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#374151] bg-white"
          >
            {(modelsData?.models || []).map((m: any) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
            {(!modelsData?.models || modelsData.models.length === 0) && (
              <option value={chatModel}>{chatModel}</option>
            )}
          </select>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#FEF3C7] flex items-center justify-center mb-4">
              <Bot size={28} className="text-[#D97706]" />
            </div>
            <h3 className="text-lg font-medium text-[#1F2937] mb-2">Ask anything about your memos</h3>
            <p className="text-sm text-[#6B7280] max-w-md">
              I'll search through your saved articles, notes, and documents to give you grounded answers with citations.
            </p>
            <p className="text-xs text-[#9CA3AF] mt-3">
              Tip: Start with @ to use general knowledge (no RAG)
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'justify-end')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[#FEF3C7] flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-[#D97706]" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[70%] rounded-2xl px-4 py-3',
                msg.role === 'user'
                  ? 'bg-[#D97706] text-white'
                  : 'bg-[#F3F4F6] text-[#1F2937]'
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{msg.content || (streaming ? '...' : '')}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 pt-2 border-t border-[#E5E7EB] flex flex-wrap gap-1.5">
                  {msg.sources.map((s: any, i: number) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-white rounded text-xs text-[#6B7280] border border-[#E5E7EB]"
                      title={s.snippet}
                    >
                      <Globe size={10} />
                      [{i + 1}] {s.title?.slice(0, 25)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-[#E5E7EB] flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-[#6B7280]" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[#E5E7EB]">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about your saved knowledge..."
            className="flex-1 px-4 py-3 border border-[#E5E7EB] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D97706]/20 focus:border-[#D97706]"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-3 bg-[#D97706] text-white rounded-xl hover:bg-[#B45309] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
