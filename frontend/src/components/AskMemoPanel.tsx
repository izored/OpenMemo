import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, Globe } from 'lucide-react';
import { chatApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { ChatSource } from '@/types';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
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
              } else if (data.type === 'error') {
                // Backend streams Ollama failures (model missing, host down) as
                // an error event — surface it instead of a silently empty reply.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant' && !last.content) last.content = 'Error: ' + data.data;
                  return [...updated];
                });
              } else if (data.type === 'done') {
                setSessionId(data.session_id);
              }
            } catch { /* malformed SSE line */ }
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'assistant') last.content = 'Error: ' + ((e as Error).message || 'Failed');
        return [...updated];
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className={`om-ask-panel${messages.length > 0 ? ' is-chatting' : ''}`}>
      <div className="om-ask-panel-head">
        <h3 className="om-ask-panel-title">
          AskMemo {memoId ? '(this memo)' : collectionId ? '(collection)' : ''}
        </h3>
      </div>

      <div ref={scrollRef} className="om-ask-panel-thread">
        {messages.length === 0 && (
          <div className="om-ask-panel-empty">
            <Bot size={24} className="om-accent-icon" />
            <p className="om-ask-panel-empty-hint">Ask questions about this content</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`om-panel-msg${msg.role === 'user' ? ' user' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="om-panel-msg-avatar">
                <Bot size={12} className="om-accent-icon" />
              </div>
            )}
            <div className={`om-panel-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
              {msg.role === 'assistant' ? (
                <div className="om-prose om-prose-chat">
                  <ReactMarkdown components={{
                    code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
                      <code className={`om-code-inline ${className || ''}`}>{children}</code>
                    ),
                    pre: ({ children }: { children?: React.ReactNode }) => (
                      <pre className="om-code-block">{children}</pre>
                    )
                  }}>{msg.content || '...'}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {msg.sources.map((s, i) => (
                    <span key={i} className="om-citation-chip">
                      <Globe size={8} /> [{i + 1}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="om-ask-panel-composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask a question..."
          className="om-ask-panel-input"
          disabled={streaming}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || streaming}
          className="om-ask-panel-send"
        >
          {streaming ? <Loader2 size={14} className="om-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
