import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { chatApi, systemApi, settingsApi } from '@/lib/api';
import type { ChatSource, OllamaModel } from '@/types';
import ReactMarkdown from 'react-markdown';
import { BorderBeam } from 'border-beam';
import { useBeamConfig, resolveBeamTheme } from '@/lib/beamConfig';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

interface Session {
  id: string;
  title: string;
  created_at: string;
}

const SUGGESTIONS = [
  'Summarize my reading this week',
  'Connect ideas across my notes',
  "What's in my inbox?",
];

// Answer mode: 'memos' = RAG over the library with citations (default);
// 'chat' = straight LLM, no retrieval. Replaces the old hidden "@" prefix
// (which still works server-side for muscle memory, but is no longer taught).
type AskMode = 'memos' | 'chat';

// The coach strip that teaches the two modes shows at most this many visits,
// then retires forever. "Got it" retires it immediately.
const COACH_KEY = 'openmemo_ask_coach_count';
const COACH_MAX_SHOWS = 30;

export function AskMemoPage() {
  const { chatModel, setChatModel } = useAppStore();
  const theme = useAppStore((s) => s.tweaks.theme);
  const beam = useBeamConfig();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // Default to memos every visit — "search my stuff" is the page's promise;
  // a sticky chat mode would silently answer from thin air days later.
  const [askMode, setAskMode] = useState<AskMode>('memos');
  const [coachVisible, setCoachVisible] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ bottom: number; right: number } | null>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick the thread to the bottom as tokens stream — but only while the user is
  // already near the bottom. The moment they scroll up to re-read, we stop
  // yanking them back down (otherwise a long streamed answer is unscrollable).
  const pinnedRef = useRef(true);
  // Abort the in-flight stream on unmount so navigating away stops the fetch
  // and the backend stops generating for a client nobody is watching (plans/010).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const { data: modelsData } = useQuery({ queryKey: ['models'], queryFn: systemApi.models });
  const { data: serverSettings } = useQuery({ queryKey: ['app-settings'], queryFn: settingsApi.get });
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['chat-sessions'],
    queryFn: chatApi.sessions,
  });

  // Pick a model when none is set (or the saved one was uninstalled):
  // server-side default first, then the first installed model.
  useEffect(() => {
    const available = (modelsData?.models || []).map((m: OllamaModel) => m.name);
    if (available.length > 0 && (!chatModel || !available.includes(chatModel))) {
      const serverDefault = serverSettings?.chat_model;
      setChatModel(serverDefault && available.includes(serverDefault) ? serverDefault : available[0]);
    }
  }, [modelsData, serverSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    // Instant (not smooth) — a smooth animation per streamed token fights the
    // user's own scroll and stutters. Pinned-to-bottom should just track.
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Mode coach: one increment per page visit, retire after COACH_MAX_SHOWS
  // visits (or the first "Got it") — by then the toggle is learned.
  useEffect(() => {
    try {
      const seen = parseInt(localStorage.getItem(COACH_KEY) || '0', 10) || 0;
      if (seen < COACH_MAX_SHOWS) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time visibility gate per visit
        setCoachVisible(true);
        localStorage.setItem(COACH_KEY, String(seen + 1));
      }
    } catch {
      /* private mode etc. — just skip the coach */
    }
  }, []);
  const dismissCoach = () => {
    setCoachVisible(false);
    try {
      localStorage.setItem(COACH_KEY, String(COACH_MAX_SHOWS));
    } catch {
      /* ignore */
    }
  };

  const loadSession = async (id: string) => {
    try {
      const msgs = await chatApi.messages(id);
      setMessages(
        (msgs || []).map((m: { id: string; role: string; content: string; sources?: ChatSource[] }) => ({
          id: m.id,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
          sources: m.sources,
        }))
      );
      setSessionId(id);
    } catch {
      /* ignore */
    }
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(null);
    setInput('');
  };

  // Anchor the model menu in fixed coords off the button rect, then portal it to
  // <body>. The composer's backdrop-filter + the BorderBeam wrap (isolation:isolate
  // with glow layers) form stacking contexts that trap an in-flow dropdown behind
  // the beam — a portal is the only reliable escape.
  const toggleModelMenu = () => {
    setModelOpen((v) => {
      const next = !v;
      if (next && modelBtnRef.current) {
        const r = modelBtnRef.current.getBoundingClientRect();
        setMenuPos({ bottom: window.innerHeight - r.top + 6, right: window.innerWidth - r.right });
      }
      return next;
    });
  };

  const handleSend = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || streaming) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
    setMessages((p) => [...p, userMsg]);
    setInput('');
    setStreaming(true);
    const assistantMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', sources: [] };
    setMessages((p) => [...p, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await chatApi.stream({
        query: userMsg.content,
        session_id: sessionId || undefined,
        model: chatModel,
        // The composer toggle decides: memos = RAG with citations, chat =
        // straight to the model. No more secret "@" prefix required.
        use_rag: askMode === 'memos',
      }, controller.signal);
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
              queryClient.invalidateQueries({ queryKey: ['chat-sessions'] });
            }
          }
        }
      }
    } catch (e) {
      // Unmount/navigation abort is not an error — the component is gone.
      if ((e as Error).name !== 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant')
            last.content = 'Error: ' + ((e as Error).message || 'Failed to get response');
          return [...updated];
        });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const hasThread = messages.length > 0;

  // Slim strip that teaches the Memos/Chat toggle. Shows on the first
  // COACH_MAX_SHOWS visits, then never again (see the mount effect above).
  const coach = coachVisible ? (
    <div className="om-ask-coach" role="note">
      <Icon name="info" size={12} />
      <p>
        <b>Memos</b> answers from your saved stuff, with citations. <b>Chat</b> talks
        straight to the model — nothing of yours is searched. Flip it next to the
        message box.
      </p>
      <button type="button" className="om-ask-coach-btn" onClick={dismissCoach}>
        Got it
      </button>
    </div>
  ) : null;

  const composerInner = (
    <div className="om-ask-composer">
      <div className="om-ask-mode" role="tablist" aria-label="Answer mode">
        <button
          type="button"
          role="tab"
          aria-selected={askMode === 'memos'}
          className={cn('om-ask-mode-btn', askMode === 'memos' && 'active')}
          onClick={() => setAskMode('memos')}
          title="Answer from your memos, with citations"
        >
          <Icon name="sparkles" size={11} />
          <span>Memos</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={askMode === 'chat'}
          className={cn('om-ask-mode-btn', askMode === 'chat' && 'active')}
          onClick={() => setAskMode('chat')}
          title="Talk to the model directly — your memos are not searched"
        >
          <Icon name="message" size={11} />
          <span>Chat</span>
        </button>
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
        placeholder={
          askMode === 'memos'
            ? 'Ask anything across your Memos…'
            : `Chat with ${chatModel || 'the model'} — memos stay out of it…`
        }
        disabled={streaming}
        autoFocus
      />
      {(modelsData?.models || []).length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            ref={modelBtnRef}
            type="button"
            className="om-model-btn mono"
            onClick={toggleModelMenu}
            title="Model"
          >
            <span>{chatModel || 'model'}</span>
            <Icon name="chevronDown" size={10} />
          </button>
          {modelOpen &&
            menuPos &&
            createPortal(
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 399 }}
                  onClick={() => setModelOpen(false)}
                />
                <div
                  className="om-model-menu"
                  style={{
                    position: 'fixed',
                    bottom: menuPos.bottom,
                    right: menuPos.right,
                    zIndex: 400,
                  }}
                >
                  {(modelsData?.models || []).map((m: OllamaModel) => (
                    <button
                      key={m.name}
                      className={cn('om-model-opt', chatModel === m.name && 'active')}
                      onClick={() => {
                        setChatModel(m.name);
                        setModelOpen(false);
                      }}
                      title={m.name}
                    >
                      <span className="mono">{m.name}</span>
                      {chatModel === m.name && <Icon name="check" size={11} />}
                    </button>
                  ))}
                </div>
              </>,
              document.body
            )}
        </div>
      )}
      <button className="om-send" onClick={() => handleSend()} disabled={streaming}>
        <Icon name="send" size={13} />
      </button>
    </div>
  );

  const composer = (
    <BorderBeam
      className="om-beam-wrap"
      size={beam.composerSize}
      colorVariant="colorful"
      theme={resolveBeamTheme(beam.themeMode, theme === 'light' ? 'light' : 'dark')}
      borderRadius={18}
      active
      staticColors={beam.staticColors}
      saturation={beam.saturation}
      hueRange={beam.hueRange}
      strength={streaming ? beam.workingStrength : beam.ambientStrength}
      brightness={streaming ? beam.workingBrightness : beam.ambientBrightness}
      duration={streaming ? beam.workingDuration : beam.ambientDuration}
    >
      {composerInner}
    </BorderBeam>
  );

  return (
    <div className={cn('om-ask-shell', historyOpen && 'history-open')}>
      <div className="om-ask-main">
        <div className="om-ask-topbar">
          <button
            className={cn('om-ask-histtoggle', historyOpen && 'active')}
            onClick={() => setHistoryOpen((v) => !v)}
            title="Chat history"
          >
            <Icon name="clock" size={13} />
            <span>History</span>
          </button>
        </div>
        {!hasThread ? (
          <div className="om-ask-hero">
            <span className="om-ask-eyebrow mono">
              Ask · {chatModel ? `model ${chatModel}` : 'local AI'}
            </span>
            <h1 className="om-ask-title">What do you remember?</h1>
            <p className="om-greet-sub" style={{ marginBottom: 8 }}>
              {askMode === 'memos'
                ? "I'll search your saved articles, notes, and documents and answer with citations."
                : `Plain chat with ${chatModel || 'your local model'} — your memos aren't touched.`}
            </p>
            {composer}
            <div className="om-ask-suggestions" style={{ justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="om-suggest" onClick={() => handleSend(s)}>
                  {s}
                </button>
              ))}
            </div>
            {coach}
          </div>
        ) : (
          <>
            <div className="om-ask-thread" ref={scrollRef} onScroll={onThreadScroll}>
              {messages.map((msg) => (
                <div key={msg.id} className={`om-msg ${msg.role}`}>
                  <div className={`om-msg-avatar ${msg.role === 'assistant' ? 'ai' : ''}`}>
                    {msg.role === 'assistant' ? <Icon name="sparkles" size={13} /> : 'RI'}
                  </div>
                  <div className="om-msg-body">
                    <span className="om-msg-meta mono">
                      {msg.role === 'assistant' ? 'openMemo' : 'You'}
                    </span>
                    {msg.role === 'assistant' ? (
                      <div
                        className="typeset typeset-chat"
                        style={{ background: 'transparent', border: 0, padding: 0 }}
                      >
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
            <div className="om-ask-composer-dock">
              {coach}
              {composer}
            </div>
          </>
        )}
      </div>

      {historyOpen && (
        <aside className="om-ask-history">
          <button className="om-ask-newchat" onClick={newChat}>
            <Icon name="plus" size={13} />
            <span>New chat</span>
          </button>
          <div className="om-ask-history-list">
            {sessions.length === 0 && (
              <p className="om-hint-readable" style={{ padding: '4px 8px' }}>
                No chats yet.
              </p>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                className={cn('om-ask-history-item', sessionId === s.id && 'active')}
                onClick={() => loadSession(s.id)}
                title={s.title}
              >
                <Icon name="message" size={12} />
                <span>{s.title || 'Untitled chat'}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
