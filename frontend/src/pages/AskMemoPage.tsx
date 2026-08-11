import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
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

// Starter prompts. A chip is a SHORTCUT: the pill shows a short human label, but
// clicking sends the full `prompt` — a properly framed instruction the local
// model can actually act on (a bare "themes across my memos" gives a weak
// answer; the expanded prompt asks for structure + citations). The full prompt
// is what lands in the thread as the user turn. All phrased around what openMemo
// holds (memos, videos, songs, articles, links, Spaces, collections) — never
// generic assistant filler. We show 3 at a time, re-picked at random on refresh.
interface Suggestion {
  label: string;
  prompt: string;
}

const SUGGESTION_POOL: Suggestion[] = [
  { label: 'Summarize my week',
    prompt: 'Summarize the memos I saved this week. Group them by theme, and for each give a one or two sentence takeaway. Cite each memo you use.' },
  { label: 'Connect ideas across my notes',
    prompt: 'Look across my saved notes and memos and find the connections between them. Point out ideas or topics that show up in more than one memo and explain how they relate, with citations.' },
  { label: "What have I saved on design?",
    prompt: 'Search my memos for anything about design and give a structured overview: the main ideas, any recurring principles, and which memos cover them. Answer only from my saved memos and cite them.' },
  { label: 'Recap my saved videos',
    prompt: 'Recap up to five of the videos I saved recently. For each, give the title and 2-3 bullets on what it covers, using the video description and transcript. Cite each one.' },
  { label: 'What songs did I save lately?',
    prompt: 'List up to five of the songs and music I saved recently, with artist and any context I noted. Answer from my saved memos only.' },
  { label: 'Surface memos I forgot about',
    prompt: "Pull up a few older memos I saved but probably haven't revisited. For each, remind me what it is and why it might still be worth my time. Cite them." },
  { label: 'Takeaways from my articles',
    prompt: 'Go through up to five of the articles I saved and extract the key takeaways from each — a few tight bullets per article, most important first, with citations.' },
  { label: 'What themes run through my memos?',
    prompt: 'Analyze my saved memos as a whole and identify the recurring themes. For each theme, name the memos that belong to it and briefly explain the throughline, with citations.' },
  { label: "What's tied to my project?",
    prompt: "Find the memos most related to what I'm currently working on. Summarize how each one connects and what I could take from it. Answer from my saved memos and cite them." },
  { label: 'What did I save from YouTube?',
    prompt: 'Show me up to five things I saved from YouTube recently. For each video, use its description and transcript to give a short summary, and cite each source.' },
  { label: 'Pull quotes worth revisiting',
    prompt: 'Find the most striking or useful quotes and passages across my saved memos and list them, each with the memo it came from. Cite each one.' },
  { label: "What's inside my Spaces?",
    prompt: 'Give me an overview of what is in my Spaces right now: the main topics and a few notable memos in each. Answer from my saved memos and cite them.' },
  { label: 'Two bullets on each recent memo',
    prompt: "For each memo I saved recently, give exactly two bullet points capturing what it's about and why it matters. Cite each memo." },
  { label: 'Which memos mention pricing?',
    prompt: 'Search my memos for anything about pricing, costs, or plans and summarize what each one says. Answer only from my saved memos and cite them.' },
  { label: 'What have I been reading lately?',
    prompt: 'Summarize what I have been reading and saving lately across articles, notes, and videos. Group by topic and highlight the throughlines, with citations.' },
  { label: 'Recap my latest collection',
    prompt: "Summarize the memos in my most recent collection. Give a short overview of the collection's theme, then a bullet per memo, with citations." },
  { label: 'Links I saved but never opened',
    prompt: "Find saved links or memos it looks like I haven't really engaged with yet. For each, tell me what it is and whether it's worth opening. Cite them." },
  { label: 'Compare two of my memos',
    prompt: 'Pick two of my saved memos that cover related ideas and compare them: where they agree, where they differ, and what I should take from each. Cite both.' },
  { label: 'What recipes have I saved?',
    prompt: 'List up to five recipes I saved, with the dish name and a quick note on ingredients or method from each memo. Answer from my saved memos and cite them.' },
  { label: 'Turn my videos into study notes',
    prompt: 'Take up to five of the videos I saved and turn them into concise study notes: key points and takeaways per video, organized clearly, using their transcripts. Cite each video.' },
];

// Fisher-Yates shuffle → first 3. Called once per mount so a refresh rotates
// the trio while it stays stable during a session.
function pickSuggestions(pool: Suggestion[], n = 3): Suggestion[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Hero lines. One picked at random per visit, then cycled while the hero is
// idle so the page never greets you the same way twice (OPNMMO-0053).
const HERO_LINES = [
  'Ask your second brain.',
  "It's all in there. Ask.",
  'Your library talks back.',
  'Saved it? Ask it.',
  'Every memo, one question away.',
  'Ask what you almost forgot.',
  'Your memos remember for you.',
  'Pull answers from everything you kept.',
  'You saved it for a reason.',
  'Talk to everything you saved.',
];
const HERO_CYCLE_MS = 6000;

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
  const location = useLocation();
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
  // Random 3 of the 20 starters, fixed for this mount (rotates on refresh).
  const [suggestions] = useState(() => pickSuggestions(SUGGESTION_POOL));
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

  // Working indicator (OPNMMO-0053). The last assistant message is "live" while
  // we stream. Until the first token lands, render an animated status row
  // (searching → reading → thinking) instead of a dead "…", so the user can see
  // work is happening. Once tokens arrive a blinking caret tails the text.
  const last = messages[messages.length - 1];
  const liveAssistant = streaming && last?.role === 'assistant' ? last : null;
  const isLiveError = !!liveAssistant && liveAssistant.content.startsWith('Error:');
  const hasTokens = !!liveAssistant && !isLiveError && liveAssistant.content.length > 0;
  const isThinking = !!liveAssistant && !hasTokens && !isLiveError;
  const foundSources = liveAssistant?.sources?.length ?? 0;

  // Pre-token status advances connecting → working after a short beat so the
  // handshake reads before "thinking". Reset whenever a new run starts.
  const [phase, setPhase] = useState<'connecting' | 'working'>('connecting');
  useEffect(() => {
    if (!isThinking) return;
    setPhase('connecting');
    const t = setTimeout(() => setPhase('working'), 900);
    return () => clearTimeout(t);
  }, [isThinking, liveAssistant?.id]);

  // Label reflects what Ask is actually doing right now: in memos mode it
  // searches, then reads the retrieved sources; in chat mode it just thinks.
  const thinkingLabel =
    askMode === 'memos'
      ? foundSources > 0
        ? `Reading ${foundSources} ${foundSources === 1 ? 'memo' : 'memos'}`
        : 'Searching your memos'
      : phase === 'connecting'
        ? 'Connecting to Ollama'
        : 'Thinking';

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

  // Clicking "Ask Memo" in the sidebar (even mid-thread) sends a fresh
  // { newChat } location state; reset to an empty new chat when it arrives.
  // Keyed on location.key so every click fires, and inlined so `newChat`
  // isn't an effect dependency.
  useEffect(() => {
    if ((location.state as { newChat?: number } | null)?.newChat) {
      setMessages([]);
      setSessionId(null);
      setInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Rotate the hero line while the empty hero is on screen. Random start so
  // two visits in a row don't open on the same words; stops once a thread
  // exists (the hero is gone anyway).
  const [heroIdx, setHeroIdx] = useState(() => Math.floor(Math.random() * HERO_LINES.length));
  useEffect(() => {
    if (hasThread) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % HERO_LINES.length), HERO_CYCLE_MS);
    return () => clearInterval(t);
  }, [hasThread]);

  // Slim strip that teaches the Memos/Chat toggle. Shows on the first
  // COACH_MAX_SHOWS visits, then never again (see the mount effect above).
  const coach = coachVisible ? (
    <div className="om-ask-coach" role="note">
      <Icon name="info" size={12} />
      <p>
        <b>Memos</b> answers from your saved memos, with citations. <b>Chat</b> ignores
        them and talks to the AI directly.
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
          {hasThread && (
            <button
              className="om-ask-histtoggle"
              onClick={newChat}
              title="Start a new chat"
            >
              <Icon name="plus" size={13} />
              <span>New chat</span>
            </button>
          )}
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
            <h1 key={heroIdx} className="om-ask-title om-ask-title-cycle">
              {HERO_LINES[heroIdx]}
            </h1>
            <p className="om-greet-sub" style={{ marginBottom: 8 }}>
              {askMode === 'memos'
                ? "I'll search your saved articles, notes, and documents and answer with citations."
                : `Plain chat with ${chatModel || 'your local model'} — your memos aren't touched.`}
            </p>
            {composer}
            <div className="om-ask-suggestions" style={{ justifyContent: 'center' }}>
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  className="om-suggest"
                  onClick={() => handleSend(s.prompt)}
                  title={s.prompt}
                >
                  {s.label}
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
                      msg.id === liveAssistant?.id && isThinking ? (
                        <div className="om-ask-status" aria-live="polite">
                          <Loader2 size={13} className="om-spin" />
                          <span className="om-ask-status-label">
                            {thinkingLabel}
                            {chatModel ? (
                              <span className="om-ask-status-model"> · {chatModel}</span>
                            ) : null}
                          </span>
                          <span className="om-ask-caret" aria-hidden="true" />
                        </div>
                      ) : (
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
                            {msg.content}
                          </ReactMarkdown>
                          {/* Blinking block caret tails the text while it streams. */}
                          {msg.id === liveAssistant?.id && hasTokens && (
                            <span className="om-ask-caret om-ask-caret-inline" aria-hidden="true" />
                          )}
                        </div>
                      )
                    ) : (
                      <p>{msg.content}</p>
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="om-msg-cards">
                        {msg.sources.map((s, i) => (
                          <Link
                            key={i}
                            to={s.memo_id ? `/memo/${s.memo_id}` : '#'}
                            className="om-ask-source"
                            title={s.title}
                            draggable={false}
                          >
                            <span className="om-ask-source-num mono">{i + 1}</span>
                            <span className="om-ask-source-title">{s.title}</span>
                            {s.domain && <span className="om-ask-source-meta mono">{s.domain}</span>}
                            <span className="om-ask-source-open">
                              <Icon name="arrowUpRight" size={11} />
                              See memo
                            </span>
                          </Link>
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
