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
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 pl-14 border-b border-[#e5e5e5]">
        <div className="flex items-center gap-2.5">
          <Sparkles size={20} className="text-[#ea2804]" />
          <h1 className="text-xl font-semibold text-[#202020] tracking-tight">AskMemo</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="px-3 py-1.5 border border-[#e5e5e5] rounded-full text-sm text-[#202020] bg-white font-mono text-xs focus:outline-none focus:border-[#202020]"
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
            <div className="w-16 h-16 rounded-full bg-[#FEE4E0] flex items-center justify-center mb-4">
              <Bot size={28} className="text-[#ea2804]" />
            </div>
            <h3 className="text-lg font-semibold text-[#202020] mb-2 tracking-tight">Ask anything about your memos</h3>
            <p className="text-sm text-[#646464] max-w-md leading-relaxed">
              I'll search through your saved articles, notes, and documents to give you grounded answers with citations.
            </p>
            <p className="text-xs text-[#8d8d8d] mt-3 font-mono">
              Tip: Start with @ to use general knowledge (no RAG)
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'justify-end')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[#FEE4E0] flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-[#ea2804]" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[70%] rounded-2xl px-4 py-3',
                msg.role === 'user'
                  ? 'bg-[#202020] text-white'
                  : 'bg-[#f5f5f5] text-[#202020]'
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown components={{
                    code: ({node, inline, className, children, ...props}: any) => (
                      inline ? (
                        <code className="bg-[#24292e] text-white px-1 py-0.5 rounded text-[11px] font-mono" {...props}>{children}</code>
                      ) : (
                        <pre className="bg-[#24292e] text-white p-3 rounded-xl overflow-x-auto font-mono text-[11px] my-2" {...props}>
                          <code>{children}</code>
                        </pre>
                      )
                    )
                  }}>{msg.content || (streaming ? '...' : '')}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 pt-2 border-t border-[#e5e5e5] flex flex-wrap gap-1.5">
                  {msg.sources.map((s: any, i: number) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-white rounded-full text-[11px] text-[#646464] border border-[#e5e5e5] font-mono"
                      title={s.snippet}
                    >
                      <Globe size={9} />
                      [{i + 1}] {s.title?.slice(0, 25)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-[#e5e5e5] flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-[#646464]" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[#e5e5e5]">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about your saved knowledge..."
            className="flex-1 px-5 py-3 border border-[#e5e5e5] rounded-full text-sm focus:outline-none focus:border-[#202020] bg-white transition-colors"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-3 bg-[#202020] text-white rounded-full hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
