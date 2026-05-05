import { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, Globe } from 'lucide-react';
import { chatApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
}

interface AskMemoPanelProps {
  memoId?: string;
  collectionId?: string;
}

export function AskMemoPanel({ memoId, collectionId }: AskMemoPanelProps) {
  const { chatModel } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        memo_id: memoId,
        collection_id: collectionId,
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
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'token') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') last.content += data.data;
                  return [...updated];
                });
              } else if (data.type === 'sources') {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') last.sources = data.data;
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
        if (last.role === 'assistant') last.content = 'Error: ' + (e.message || 'Failed');
        return [...updated];
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-[#e5e5e5]">
        <h3 className="text-sm font-semibold text-[#202020]">
          AskMemo {memoId ? '(this memo)' : collectionId ? '(collection)' : ''}
        </h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot size={24} className="mx-auto mb-2 text-[#ea2804]" />
            <p className="text-xs text-[#646464]">Ask questions about this content</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-[#FEE4E0] flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot size={12} className="text-[#ea2804]" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${msg.role === 'user' ? 'bg-[#202020] text-white' : 'bg-[#f5f5f5] text-[#202020]'}`}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-xs max-w-none">
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
                  }}>{msg.content || '...'}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {msg.sources.map((s: any, i: number) => (
                    <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-white rounded-full text-[10px] text-[#646464] border border-[#e5e5e5]">
                      <Globe size={8} /> [{i + 1}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-[#e5e5e5]">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-2 border border-[#e5e5e5] rounded-full text-sm focus:outline-none focus:border-[#202020] bg-white transition-colors"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-2.5 bg-[#202020] text-white rounded-full disabled:opacity-40 hover:bg-black transition-colors"
          >
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
