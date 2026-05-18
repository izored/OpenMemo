import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { chatApi, systemApi } from '@/lib/api';
import type { ChatSource, OllamaModel } from '@/types';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

const SUGGESTIONS = [
  'Summarize my reading this week',
  'Connect ideas across my notes',
  "What's in my inbox?",
];

export function AskMemoPage() {
  const { chatModel, setChatModel } = useAppStore();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: modelsData } = useQuery({ queryKey: ['models'], queryFn: systemApi.models });

  useEffect(() => {
    const available = (modelsData?.models || []).map((m: OllamaModel) => m.name);
    if (available.length > 0 && (!chatModel || !available.includes(chatModel))) {
      setChatModel(available[0]);
    }
  }, [modelsData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || streaming) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages((p) => [...p, userMsg]);
    setInput('');
    setStreaming(true);
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', sources: [] };
    setMessages((p) => [...p, assistantMsg]);

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
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (data.type === 'token') {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last.role === 'assistant')
                  return [...prev.slice(0, -1), { ...last, content: last.content + data.data }];
                return prev;
              });
            } else if (data.type === 'sources') {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last.role === 'assistant')
                  return [...prev.slice(0, -1), { ...last, sources: data.data as ChatSource[] }];
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
        if (last.role === 'assistant')
          last.content = 'Error: ' + ((e as Error).message || 'Failed to get response');
        return [...updated];
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="om-ask" ref={scrollRef}>
      <div className="om-ask-head">
        <span className="om-ask-eyebrow mono">
          Ask · {chatModel ? `model ${chatModel}` : 'local AI'}
        </span>
        <h1 className="om-ask-title">What do you remember?</h1>
      </div>

      <div className="om-ask-thread">
        {messages.length === 0 && (
          <p className="om-msg-body" style={{ color: 'var(--text-3)', fontSize: 15 }}>
            I'll search your saved articles, notes, and documents and answer with citations.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`om-msg ${msg.role}`}>
            <div className={`om-msg-avatar ${msg.role === 'assistant' ? 'ai' : ''}`}>
              {msg.role === 'assistant' ? <Icon name="sparkles" size={13} /> : 'RI'}
            </div>
            <div className="om-msg-body">
              <span className="om-msg-meta mono">
                {msg.role === 'assistant' ? 'OpenMemo' : 'You'}
              </span>
              {msg.role === 'assistant' ? (
                <div className="om-detail-summary" style={{ background: 'transparent', border: 0, padding: 0 }}>
                  <ReactMarkdown
                    components={{
                      code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
                        <code className={`mono ${className || ''}`}>{children}</code>
                      ),
                    }}
                  >
                    {msg.content || (streaming ? '…' : '')}
                  </ReactMarkdown>
                </div>
              ) : (
                <p>{msg.content}</p>
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="om-msg-cards">
                  {msg.sources.map((s, i) => (
                    <div
                      key={i}
                      className="om-ask-source"
                      onClick={() => s.memo_id && navigate(`/memo/${s.memo_id}`)}
                    >
                      <span className="om-ask-source-num mono">{i + 1}</span>
                      <div>
                        <p className="om-ask-source-title">{s.title}</p>
                        <span className="om-ask-source-meta mono">{s.domain}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="om-ask-composer-wrap">
        {messages.length === 0 && (
          <div className="om-ask-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="om-suggest" onClick={() => handleSend(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="om-ask-composer">
          <Icon name="sparkles" size={14} />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask anything across your memos…"
            disabled={streaming}
          />
          {(modelsData?.models || []).length > 0 && (
            <select
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="mono"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-2)',
                fontSize: 11,
                padding: '4px 6px',
              }}
            >
              {(modelsData?.models || []).map((m: OllamaModel) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button className="om-send" onClick={() => handleSend()} disabled={streaming}>
            <Icon name="send" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
