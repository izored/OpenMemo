import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Bot, User, Loader2, Sparkles, Globe } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { chatApi, systemApi } from '@/lib/api';
import type { ChatSource, OllamaModel } from '@/types';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
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

  // Auto-select first available model if none chosen or saved model no longer exists
  useEffect(() => {
    const available = (modelsData?.models || []).map((m: OllamaModel) => m.name);
    if (available.length > 0 && (!chatModel || !available.includes(chatModel))) {
      setChatModel(available[0]);
    }
  }, [modelsData]); // eslint-disable-line react-hooks/exhaustive-deps

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

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

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
            let data: Record<string, unknown>;
            try { data = JSON.parse(line.slice(6)); } catch { continue; }

            if (data.type === 'token') {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: last.content + data.data }];
                }
                return prev;
              });
            } else if (data.type === 'sources') {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, sources: data.data as ChatSource[] }];
                }
                return prev;
              });
            } else if (data.type === 'error') {
              throw new Error((data.data as string) || 'Ollama error');
            } else if (data.type === 'done') {
              setSessionId(data.session_id as string | null);
            }
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') {
          last.content = 'Error: ' + ((e as Error).message || 'Failed to get response');
        }
        return [...updated];
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-card)] rounded-2xl overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 pl-14 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2.5">
          <Sparkles size={20} className="text-[var(--color-brand)]" />
          <h1 className="text-xl font-semibold text-[var(--color-text)] tracking-tight">AskMemo</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="px-3 py-1.5 border border-[var(--color-border)] rounded-full text-sm text-[var(--color-text)] bg-[var(--color-bg-card)] font-mono text-xs focus:outline-none focus:border-[var(--color-text)]"
          >
            {(modelsData?.models || []).map((m: OllamaModel) => (
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
            <div className="w-16 h-16 rounded-full bg-[var(--color-brand-light)] flex items-center justify-center mb-4">
              <Bot size={28} className="text-[var(--color-brand)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2 tracking-tight">Ask anything about your memos</h3>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-md leading-relaxed">
              I'll search through your saved articles, notes, and documents to give you grounded answers with citations.
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-3 font-mono">
              Tip: Start with @ to use general knowledge (no RAG)
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' && 'justify-end')}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-[var(--color-brand-light)] flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-[var(--color-brand)]" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[70%] rounded-2xl px-4 py-3',
                msg.role === 'user'
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)]'
                  : 'bg-[var(--color-bg-hover)] text-[var(--color-text)]'
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown components={{
                    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
                      <code className={`bg-[var(--color-bg-code)] text-white px-1 py-0.5 rounded text-[11px] font-mono ${className || ''}`}>{children}</code>
                    ),
                    pre: ({ children }: { children?: React.ReactNode }) => (
                      <pre className="bg-[var(--color-bg-code)] text-white p-3 rounded-xl overflow-x-auto font-mono text-[11px] my-2 [&_code]:bg-transparent [&_code]:p-0">
                        {children}
                      </pre>
                    )
                  }}>{msg.content || (streaming ? '...' : '')}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-3 pt-2 border-t border-[var(--color-border)] flex flex-wrap gap-1.5">
                  {msg.sources.map((s, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[var(--color-bg-card)] rounded-full text-[11px] text-[var(--color-text-secondary)] border border-[var(--color-border)] font-mono"
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
              <div className="w-8 h-8 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center flex-shrink-0">
                <User size={16} className="text-[var(--color-text-secondary)]" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-2 max-w-3xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about your saved knowledge..."
            className="flex-1 px-5 py-3 border border-[var(--color-border)] rounded-full text-sm focus:outline-none focus:border-[var(--color-text)] bg-[var(--color-bg-card)] transition-colors"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="p-3 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full hover:bg-[var(--color-text)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
