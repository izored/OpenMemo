import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { ChangelogModal, cmpVersion } from '@/components/ChangelogModal';
import { MeshIntroModal } from '@/components/MeshIntroModal';
import { MeshConflictModal } from '@/components/MeshConflictModal';
import { MeshPairingPanel } from '@/components/MeshPairingPanel';
import { meshApi, type MeshBatch } from '@/lib/api';
import { ONBOARDING_KEY } from '@/lib/onboarding';
import { useAppStore } from '@/stores/appStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import { CookiesUpload } from '@/components/CookiesUpload';
import { systemApi, maintenanceApi, backupApi, settingsApi, memoApi, type AppSettings, type LibraryIntegrity, type MusicRelayStatus, type TelegramRelayStatus } from '@/lib/api';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OllamaModel } from '@/types';

type BuiltWithEntry = { name: string; url: string; desc: string };

const BUILT_WITH_LEAD =
  'openMemo stands on a stack of free, open-source software. Hover any name to see what it does.';

function BuiltWith({ entries }: { entries: BuiltWithEntry[] }) {
  // Auto-scrolling band. The track is rendered twice back-to-back and animated
  // -50% so the loop is seamless; hovering the band pauses it. Hovering a pill
  // swaps the lead line for that project's description (no floating tooltip),
  // and the line reverts when the pointer leaves the band.
  const [hover, setHover] = useState<BuiltWithEntry | null>(null);
  const loop = [...entries, ...entries];
  return (
    <>
      <p className="om-built-with-lead" aria-live="polite">
        {hover ? (
          <>
            <span className="om-bw-lead-name">{hover.name}</span> {hover.desc}
          </>
        ) : (
          BUILT_WITH_LEAD
        )}
      </p>
      <div className="om-bw-band" onMouseLeave={() => setHover(null)}>
        <div className="om-bw-track">
          {loop.map((d, i) => (
            <a
              key={`${d.name}-${i}`}
              className="om-bw-pill"
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-hidden={i >= entries.length}
              tabIndex={i >= entries.length ? -1 : 0}
              onMouseEnter={() => setHover(d)}
              onFocus={() => setHover(d)}
            >
              {d.name}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

const BUILT_WITH: BuiltWithEntry[] = [
  { name: 'React', url: 'https://react.dev', desc: 'The UI library every screen is built on — components, hooks, the whole shape of the frontend.' },
  { name: 'Vite', url: 'https://vitejs.dev', desc: 'Dev server + build tool. Instant HMR while building, a tiny production bundle when shipping.' },
  { name: 'FastAPI', url: 'https://fastapi.tiangolo.com', desc: 'The Python web framework powering the API. Async-first, type-safe via Pydantic, OpenAPI for free.' },
  { name: 'SQLite', url: 'https://sqlite.org', desc: 'The single-file database holding every memo, collection, tag and chat. Embedded, zero-config, fast.' },
  { name: 'Ollama', url: 'https://ollama.com', desc: 'Runs the local LLMs that power chat, summarisation and embeddings — no cloud round-trip, no API key.' },
  { name: 'ChromaDB', url: 'https://www.trychroma.com', desc: 'Vector store for memo embeddings. Makes "search by meaning" possible against your own knowledge base.' },
  { name: 'TanStack Query', url: 'https://tanstack.com/query', desc: 'Frontend cache + data fetching. Keeps memos, stats and collections in sync without manual wiring.' },
  { name: 'Zustand', url: 'https://github.com/pmndrs/zustand', desc: 'Tiny state store for sidebar, filters, sort mode and appearance — no boilerplate, no providers.' },
  { name: 'framer-motion', url: 'https://motion.dev', desc: 'Every spring, fade and layout animation in the UI. The sidebar collapse, the filter pill, the card transitions.' },
  { name: 'dnd-kit', url: 'https://dndkit.com', desc: 'Drag-and-drop primitives behind reordering memos and dropping cards into collections.' },
  { name: 'MDXEditor', url: 'https://mdxeditor.dev', desc: 'The rich Markdown editor for notes and memo content — WYSIWYG with real Markdown underneath.' },
  { name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp', desc: 'Pulls title, description and thumbnails from YouTube and social-video URLs so saving a link gives a rich memo.' },
];

type Stats = {
  total_memos: number;
  total_collections: number;
  total_tags: number;
  memos_this_week: number;
  by_type: Record<string, number>;
  storage?: { db_bytes: number; files_bytes: number; cache_bytes: number; total_bytes: number };
};

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function SettingCard({
  title,
  eyebrow,
  span,
  className = '',
  children,
}: {
  title: string;
  eyebrow: string;
  span?: 2 | 3 | 4 | 6;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`om-setting-card${span ? ` s${span}` : ''}${className ? ` ${className}` : ''}`}>
      <div className="om-setting-head">
        <span className="mono om-setting-eyebrow">{eyebrow}</span>
        <h3 className="om-setting-title">{title}</h3>
      </div>
      <div className="om-setting-body">{children}</div>
    </div>
  );
}

function RecentlyDeletedModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);
  const { data: deleted = [], isLoading } = useQuery({
    queryKey: ['memos', 'deleted'],
    queryFn: memoApi.listDeleted,
  });

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const restore = async (id: string) => {
    try {
      await memoApi.restore(id);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'deleted'] });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div ref={modalRef} className="om-modal" role="dialog" aria-label="Recently Deleted">
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">Trash</span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>Recently Deleted</b>
          </div>
          <button className="om-icon-btn" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="om-modal-body" style={{ gap: 8 }}>
          {isLoading && <p className="om-hint-readable">Loading…</p>}
          {!isLoading && deleted.length === 0 && (
            <p className="om-hint-readable" style={{ fontSize: 13, color: 'var(--text-4)' }}>No recently deleted memos.</p>
          )}
          {deleted.map((m) => (
            <div key={m.id} className="om-setting-row" style={{ gap: 10 }}>
              <div className="om-setting-row-text" style={{ minWidth: 0 }}>
                <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</p>
                <span className="mono" style={{ fontSize: 11 }}>{m.type} · {m.deleted_at ? new Date(m.deleted_at).toLocaleDateString() : ''}</span>
              </div>
              <button className="om-btn-secondary" onClick={() => restore(m.id)}>Restore</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TrashRow() {
  // Recently-deleted lives as a row inside the Files card now, not its own card.
  const [open, setOpen] = useState(false);
  const { data: deleted = [], isLoading } = useQuery({
    queryKey: ['memos', 'deleted'],
    queryFn: memoApi.listDeleted,
  });

  // No own `om-setting-row` — the caller already wraps this in one. A nested
  // row would collapse to content width inside the parent's space-between flex,
  // so "Open trash" wouldn't right-align with the other controls.
  return (
    <>
      <div className="om-setting-row-text">
        <p>Recently deleted</p>
        {isLoading ? (
          <span className="om-skel" />
        ) : (
          <span className="mono">{deleted.length} deleted memo{deleted.length === 1 ? '' : 's'} can be restored</span>
        )}
      </div>
      <button className="om-btn-secondary" onClick={() => setOpen(true)}>Open trash</button>
      {open && <RecentlyDeletedModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Library integrity: do the files the database references still exist?
 *
 *  On 2026-08-04 a test run deleted 435 media files and openMemo served pages
 *  normally for ninety minutes, because nothing ever asked. It asks hourly now,
 *  and this is where the answer shows up. */
function LibraryIntegrityRows() {
  const [state, setState] = useState<LibraryIntegrity | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    settingsApi.libraryIntegrity().then(setState).catch(() => setState(null));
  }, []);

  const checkNow = async () => {
    setBusy(true);
    try { setState(await settingsApi.libraryIntegrityCheck()); }
    catch { /* leave the last known result on screen */ }
    finally { setBusy(false); }
  };

  const missing = state ? state.missing_media + state.missing_thumbs : 0;
  const incident = state?.status === 'incident';

  return (
    <>
      <div className="om-setting-row">
        <div className="om-setting-row-text">
          <p>Library integrity</p>
          <span className="mono">
            {!state
              ? 'Checking…'
              : missing === 0
                ? `All ${state.with_media} media files and ${state.with_thumb} thumbnails are on disk`
                : `${state.missing_media} media file${state.missing_media === 1 ? '' : 's'} and ${state.missing_thumbs} thumbnail${state.missing_thumbs === 1 ? '' : 's'} missing of ${state.with_media + state.with_thumb}`}
          </span>
        </div>
        <button className="om-btn-secondary" onClick={checkNow} disabled={busy}>
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {/* Loud only when it is news. A library that has been missing the same
          59 uploads for a month is a known state; more missing than at the
          last check is an incident, and saying so early is the entire point. */}
      {state && (missing > 0 || state.silent_videos > 0) && (
        <div
          role="status"
          style={{
            border: `1px solid var(${incident ? '--border-danger, #D65C5C' : '--border-warning, #E5C07B'})`,
            background: `var(${incident ? '--bg-danger, rgba(198,40,40,0.08)' : '--bg-warning, rgba(186,117,23,0.08)'})`,
            borderRadius: 10, padding: '10px 12px', margin: '4px 0 8px',
          }}
        >
          <p style={{ margin: 0, fontWeight: 500, color: `var(${incident ? '--text-danger, #C62828' : '--text-warning, #BA7517'})` }}>
            {incident
              ? `${state.delta} more file${state.delta === 1 ? '' : 's'} went missing since the last check`
              : `${missing} file${missing === 1 ? '' : 's'} referenced by your library are missing from disk`}
          </p>
          <span className="mono" style={{ display: 'block', marginTop: 4 }}>
            {state.recoverable > 0 && (
              <>{state.recoverable} can be re-downloaded from their source. </>
            )}
            {state.unrecoverable > 0 && (
              <>{state.unrecoverable} were uploads with no source and exist nowhere else. </>
            )}
            {state.missing_thumbs > 0 && (
              <>{state.missing_thumbs} missing thumbnail{state.missing_thumbs === 1 ? '' : 's'} can be regenerated. </>
            )}
            {state.silent_videos > 0 && (
              <>{state.silent_videos} video{state.silent_videos === 1 ? ' has' : 's have'} no sound. Often the original has none either — plenty of clips are posted muted — so this is worth a look rather than an alarm. Re-pull one from its own page to try again. </>
            )}
            {incident && 'Stop writing to the disk before investigating — see docs/DISASTER-RECOVERY.md.'}
          </span>
        </div>
      )}
    </>
  );
}


/** Music relay: the lossless source behind Apple Music and Spotify pulls.
 *
 *  It stopped accepting a shared key in August 2026 and now issues sessions
 *  only after a challenge a person completes in a browser. That is the point of
 *  the challenge, so openMemo hands you the link and waits rather than trying
 *  to answer it for you. */
function MusicRelayRows() {
  const [state, setState] = useState<MusicRelayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const pollRef = useRef<number | null>(null);

  const refresh = () => { settingsApi.musicRelayStatus().then(setState).catch(() => setState(null)); };
  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const verify = async () => {
    setBusy(true); setMsg('');
    try {
      const { challenge_url } = await settingsApi.musicRelayVerifyStart(window.location.origin);
      window.open(challenge_url, '_blank', 'noopener');
      setMsg('Complete the challenge in the tab that opened. This will update when it lands.');
      // The relay redirects the browser straight back to openMemo, so nothing
      // notifies this component — poll until the session shows up, and give up
      // after five minutes rather than spinning forever.
      const started = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const next = await settingsApi.musicRelayStatus();
          setState(next);
          if (next.verified || Date.now() - started > 5 * 60_000) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
            setMsg(next.verified ? 'Verified ✓' : 'Gave up waiting. Try again when you have a minute.');
          }
        } catch { /* keep waiting */ }
      }, 3000);
    } catch (e) {
      setBusy(false);
      setMsg(e instanceof Error ? e.message : 'Could not start verification');
    }
  };

  const disconnect = async () => {
    try { setState(await settingsApi.musicRelayDisconnect()); setMsg(''); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div className="om-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="om-setting-row-text" style={{ maxWidth: 560 }}>
        <p>Music relay</p>
        <span className="mono">
          Apple Music and Spotify links are pulled as lossless FLAC through a shared community
          relay. It only answers verified clients now, so it needs a one-off challenge that you
          complete in your browser. Nothing is signed up for and no account is involved.
        </span>
      </div>

      {state && !state.verified && (
        <div
          role="status"
          style={{
            border: '1px solid var(--border-warning, #E5C07B)',
            background: 'var(--bg-warning, rgba(186,117,23,0.08))',
            borderRadius: 10, padding: '10px 12px', maxWidth: 560,
          }}
        >
          <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-warning, #BA7517)' }}>
            {state.expired ? 'The music relay session has expired' : 'Apple Music and Spotify pulls are not working'}
          </p>
          <span className="mono" style={{ display: 'block', marginTop: 4 }}>
            Every Apple Music and Spotify download fails until this is verified. Everything else
            (YouTube, SoundCloud, Instagram, uploads) is unaffected.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {state?.verified ? (
          <>
            <span style={{ color: 'var(--text-success, #1D9E75)', fontWeight: 500 }}>
              Verified ✓{state.expires_in_days !== null ? ` · ${state.expires_in_days} days left` : ''}
            </span>
            <button className="om-btn-secondary" onClick={disconnect}>Disconnect</button>
          </>
        ) : (
          <button className="om-btn-secondary" onClick={verify} disabled={busy}>
            {busy ? 'Waiting for you…' : 'Verify'}
          </button>
        )}
      </div>
      {msg && <span className="mono" style={{ fontSize: 11 }}>{msg}</span>}
    </div>
  );
}

/** Instagram connect: the final-fallback session for IG pulls. Two ways in —
 *  paste a session (safe, no password) or username/password (convenient, but IG
 *  may checkpoint your main account; the UI warns). Feeds the shared cookie jar. */
function InstagramConnectRows() {
  const [status, setStatus] = useState<{ connected: boolean; who: string | null } | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof settingsApi.instagramHealth>> | null>(null);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [cookies, setCookies] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'password' | 'session'>('password');

  const refresh = () => {
    settingsApi.instagramStatus().then(setStatus).catch(() => setStatus(null));
    settingsApi.instagramHealth().then(setHealth).catch(() => setHealth(null));
  };
  useEffect(() => { refresh(); }, []);

  const doLogin = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await settingsApi.instagramLogin(user.trim(), pass);
      setStatus({ connected: r.connected, who: r.who });
      setPass(''); setMsg(r.connected ? 'Connected ✓' : '');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Login failed'); }
    finally { setBusy(false); }
  };
  const doImport = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await settingsApi.instagramImportSession(cookies);
      setStatus(r); setCookies(''); setMsg(r.connected ? 'Connected ✓' : '');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  };
  const doDisconnect = async () => {
    setBusy(true); setMsg('');
    try { setStatus(await settingsApi.instagramDisconnect()); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="om-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
      <div className="om-setting-row-text" style={{ maxWidth: 560 }}>
        <p>Instagram login</p>
        <span className="mono">
          openMemo pulls Instagram post media through a login. Connect an account here and every Instagram save — photos, carousels, reels — resolves. The session is stored only on this machine (in <code>yt_cookies.txt</code>), never sent anywhere. Use a throwaway account.
        </span>
      </div>

      {/* The silent-degradation warning. Instagram saves never fail outright —
          a blocked tier still produces a memo, just a poorer one (a reel as a
          still, a carousel as one photo), which is exactly how six weeks of
          bad saves went unnoticed. Say it out loud instead. */}
      {health && health.status !== 'ok' && (
        <div
          role="status"
          style={{
            border: '1px solid var(--border-warning, #E5C07B)',
            background: 'var(--bg-warning, rgba(186,117,23,0.08))',
            borderRadius: 10, padding: '10px 12px', maxWidth: 560,
          }}
        >
          <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-warning, #BA7517)' }}>
            {health.status === 'session_expired'
              ? 'Instagram session no longer works'
              : 'Instagram saves are running without a session'}
          </p>
          <span className="mono" style={{ display: 'block', marginTop: 4 }}>
            {health.degraded} of the last {health.checked} Instagram saves fell back to
            reading the public page. Those still save, but only what a logged-out
            visitor can see: reels can miss their video and carousels can arrive as a
            single photo.{' '}
            {health.status === 'session_expired'
              ? 'Reconnect below to fix it.'
              : 'Connect an account below to fix it.'}
          </span>
        </div>
      )}

      {status?.connected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--text-success, #1D9E75)', fontWeight: 500 }}>
            Connected{status.who ? ` (${status.who})` : ''} ✓
          </span>
          <button className="om-btn-secondary" onClick={doDisconnect} disabled={busy}>Disconnect</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="om-btn-secondary" style={{ opacity: mode === 'password' ? 1 : 0.6 }} onClick={() => setMode('password')}>Username & password</button>
            <button className="om-btn-secondary" style={{ opacity: mode === 'session' ? 1 : 0.6 }} onClick={() => setMode('session')}>Import session</button>
          </div>

          {mode === 'password' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
              <input className="om-input" placeholder="Instagram username" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
              <input className="om-input" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
              <button className="om-btn-secondary" onClick={doLogin} disabled={busy || !user || !pass}>
                {busy ? 'Logging in…' : 'Log in'}
              </button>
              <span className="mono" style={{ color: 'var(--text-warning, #BA7517)' }}>
                Heads up: automated logins can trip Instagram's checks and flag your account. For your main account, prefer "Import session". The password is used once to sign in and is never stored.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
              <textarea
                className="om-input"
                placeholder="Paste your Instagram cookies.txt (Netscape format) — export it from a browser where you're logged in"
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                rows={4}
                style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              />
              <button className="om-btn-secondary" onClick={doImport} disabled={busy || !cookies.trim()}>
                {busy ? 'Importing…' : 'Import session'}
              </button>
            </div>
          )}
        </>
      )}
      {msg && <span className="mono" style={{ color: msg.includes('✓') ? 'var(--text-success, #1D9E75)' : 'var(--text-danger, #E24B4A)' }}>{msg}</span>}
    </div>
  );
}

/** In-brand dropdown for the app-wide default chat model. Writes to the
 *  persisted `chatModel` in the app store (read by every Ask/chat surface) AND
 *  to the server-side `chat_model` setting, so backend-initiated calls
 *  (summaries without an explicit model) use the same default. */
function MeshRows({ profile, save }: { profile: AppSettings | null; save: (p: Partial<AppSettings>) => void }) {
  const enabled = profile?.mesh_enabled ?? false;
  const [introOpen, setIntroOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const [batches, setBatches] = useState<MeshBatch[]>([]);
  const [meshError, setMeshError] = useState('');

  // Everything Mesh exposes 404s while it is off, so a failure here is the
  // normal disabled state rather than something worth showing the user.
  useEffect(() => {
    if (!enabled) {
      setConflictCount(0);
      setBatches([]);
      return;
    }
    meshApi.conflicts().then((r) => setConflictCount(r.count)).catch(() => setConflictCount(0));
    meshApi.history(5).then((r) => setBatches(r.batches)).catch(() => setBatches([]));
  }, [enabled, conflictsOpen]);

  // Explain Mesh at the moment it is switched ON, not on every render and not
  // when it is switched off — an explainer that appears while you are turning
  // something off is noise.
  const toggle = () => {
    if (!profile) return;
    const next = !profile.mesh_enabled;
    save({ mesh_enabled: next });
    if (next) setIntroOpen(true);
  };

  return (
    <>
      <div className="om-setting-row">
        <div className="om-setting-row-text">
          <p>Mesh</p>
          <span className="mono">
            Keep this computer and another one on the same library. Both can add and edit; changes flow both ways. No account, no cloud, no server in the middle — you pair them once with a 12-word code. Off by default, and while it is off Mesh costs this install nothing at all.
          </span>
        </div>
        <button
          type="button"
          className="om-add-toggle"
          onClick={toggle}
          aria-pressed={enabled}
        >
          <span className={'om-add-toggle-switch' + (enabled ? ' on' : '')}>
            <span className="om-add-toggle-knob" />
          </span>
        </button>
      </div>
      <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
        <div className="om-setting-row-text">
          <p>{enabled ? (profile?.mesh_reachable ? 'Ready to pair' : 'Pairing only') : 'How Mesh works'}</p>
          <span className="mono">
            {/* The copy has to track the LISTENER, not just the flag. Bound to
                loopback — the default — pairing works and sync can never
                connect, which is exactly the silent half-working state this
                page used to describe as if it were fine. */}
            {enabled
              ? (profile?.mesh_reachable
                  ? 'Mesh is on and this computer accepts connections from your other one. Pair them below with a 12-word code, once. Nothing leaves your network and no account is involved. '
                  : 'Mesh is on, but this computer only listens to itself, so pairing works and syncing cannot connect yet. Turn on "Reachable from your other computer" below when you are ready. ')
              : 'One library across both computers, paired once with a 12-word code, with nothing in the middle. '}
            <button type="button" onClick={() => setIntroOpen(true)} style={{ color: 'var(--accent)', fontWeight: 500 }}>
              {enabled ? 'Read the walkthrough again' : 'What is Mesh?'}
            </button>
          </span>
        </div>
      </div>
      {enabled && (
        <div className="om-setting-row">
          <div className="om-setting-row-text" style={{ maxWidth: 560 }}>
            <p>Reachable from your other computer</p>
            <span className="mono">
              Opens port 8770 so the other machine can actually sync with this one. Off, openMemo
              listens only to itself: you can still pair, but nothing will ever connect. The port
              speaks a protocol that refuses anyone without your 12-word code, and five bad tries
              earns a lockout — but it is still a port, so it is your call. This also covers
              Tailscale and the like: they appear as ordinary network interfaces, which is how two
              computers on different networks find each other.
            </span>
          </div>
          <button
            type="button"
            className="om-add-toggle"
            onClick={() => profile && save({ mesh_reachable: !profile.mesh_reachable })}
            aria-pressed={!!profile?.mesh_reachable}
          >
            <span className={'om-add-toggle-switch' + (profile?.mesh_reachable ? ' on' : '')}>
              <span className="om-add-toggle-knob" />
            </span>
          </button>
        </div>
      )}
      {enabled && <MeshPairingPanel />}
      {enabled && conflictCount > 0 && (
        <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
          <div className="om-setting-row-text">
            <p>{conflictCount} {conflictCount === 1 ? 'thing needs' : 'things need'} your decision</p>
            <span className="mono">
              Both computers changed the same thing. Nothing has been overwritten — openMemo is waiting for you to choose, and keeping both is the default.
            </span>
          </div>
          <button type="button" className="om-btn-primary" onClick={() => setConflictsOpen(true)}>
            Review
          </button>
        </div>
      )}
      {enabled && batches.length > 0 && (
        <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="om-setting-row-text" style={{ marginBottom: 6 }}>
            <p>Recent syncs</p>
            <span className="mono">Every change Mesh made, and where it came from. Any of these can be undone.</span>
          </div>
          {meshError && (
            <p className="mono" style={{ color: '#EF5048', margin: '0 0 6px' }}>{meshError}</p>
          )}
          {batches.map((b) => (
            <div key={b.batch_id} className="om-mesh-batch">
              <div className="om-mesh-batch-main">
                <b>{b.changes} {b.changes === 1 ? 'change' : 'changes'} from {b.peer || 'a device'}</b>
                <span>{new Date(b.at).toLocaleString()}{b.undone ? ' · undone' : ''}</span>
              </div>
              {!b.undone && (
                <button
                  type="button"
                  className="om-btn-secondary"
                  onClick={async () => {
                    // An undo that fails must say so. Swallowing it would leave
                    // the user believing a sync was reversed when it was not,
                    // which is worse than the original bad sync.
                    try {
                      await meshApi.undo(b.batch_id);
                      setMeshError('');
                    } catch (e) {
                      setMeshError(e instanceof Error ? e.message : 'Could not undo that sync');
                      return;
                    }
                    const r = await meshApi.history(5).catch(() => ({ batches: [] as MeshBatch[] }));
                    setBatches(r.batches);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {introOpen && <MeshIntroModal onClose={() => setIntroOpen(false)} />}
      {conflictsOpen && <MeshConflictModal onClose={() => setConflictsOpen(false)} />}
    </>
  );
}


function TelegramRelayRows({ profile, save }: { profile: AppSettings | null; save: (p: Partial<AppSettings>) => void }) {
  const [tokenInput, setTokenInput] = useState('');
  const [tokenPresent, setTokenPresent] = useState<boolean | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [status, setStatus] = useState<TelegramRelayStatus | null>(null);

  useEffect(() => {
    settingsApi.telegramStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const present = tokenPresent ?? profile?.telegram_token_present ?? false;
  const enabled = profile?.telegram_enabled ?? false;

  const saveToken = async () => {
    setTokenError('');
    try {
      const r = await settingsApi.setTelegramToken(tokenInput);
      setTokenPresent(r.telegram_token_present);
      setTokenInput('');
    } catch (e) {
      setTokenError(e instanceof Error ? e.message : 'Failed to save token');
    }
  };

  const clearToken = async () => {
    const r = await settingsApi.setTelegramToken('');
    setTokenPresent(r.telegram_token_present);
  };

  const statusLine = !present
    ? 'Paste a bot token from @BotFather to begin.'
    : !enabled
      ? 'Token stored. Turn the relay on to start polling.'
      : status?.last_error
        ? `Error: ${status.last_error}`
        : status?.last_poll_at
          ? `Polling. Last check ${new Date(status.last_poll_at + 'Z').toLocaleTimeString()} · ${status.saved_count} saved this session`
          : 'On — first poll runs within a minute.';

  return (
    <>
      <div className="om-setting-row">
        <div className="om-setting-row-text">
          <p>Telegram capture</p>
          <span className="mono">
            Share any link to your private bot chat and it lands here, filed into "{profile?.telegram_default_collection || 'IG Inbox'}". openMemo polls Telegram outbound — no open ports, and messages queue while this machine sleeps. {statusLine}
          </span>
        </div>
        <button
          type="button"
          className="om-add-toggle"
          onClick={() => profile && save({ telegram_enabled: !profile.telegram_enabled })}
          aria-pressed={enabled}
          disabled={!present}
        >
          <span className={'om-add-toggle-switch' + (enabled && present ? ' on' : '')}>
            <span className="om-add-toggle-knob" />
          </span>
        </button>
      </div>
      <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
        <div className="om-setting-row-text">
          <p>Bot token</p>
          <span className="mono">
            {present
              ? `Stored on this machine, never shown or sent anywhere else.${profile?.telegram_user_locked || status?.telegram_user_locked ? ' Locked to the first sender.' : ' Locks to the first person who messages the bot.'}`
              : 'From Telegram: @BotFather → /newbot → copy the token.'}
            {tokenError ? ` ${tokenError}` : ''}
          </span>
        </div>
        {present ? (
          <button className="om-btn-secondary" onClick={clearToken}>Remove</button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              className="om-input"
              placeholder="123456:ABC…"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              style={{ width: 180 }}
            />
            <button className="om-btn-secondary" onClick={saveToken} disabled={!tokenInput.trim()}>
              Save
            </button>
          </div>
        )}
      </div>
      <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
        <div className="om-setting-row-text">
          <p>Pull media locally</p>
          <span className="mono">
            Download the actual photo, video, or audio for every bot save so it survives takedown. Off = bot saves follow the same auto-download rules as a paste.
          </span>
        </div>
        <button
          type="button"
          className="om-add-toggle"
          onClick={() => profile && save({ telegram_force_localize: !profile.telegram_force_localize })}
          aria-pressed={profile?.telegram_force_localize ?? true}
        >
          <span className={'om-add-toggle-switch' + ((profile?.telegram_force_localize ?? true) ? ' on' : '')}>
            <span className="om-add-toggle-knob" />
          </span>
        </button>
      </div>
      <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
        <div className="om-setting-row-text">
          <p>Check every</p>
          <span className="mono">How often openMemo asks Telegram for new shares. Capture is queued, not lost, between checks.</span>
        </div>
        <select
          className="om-input"
          value={String(profile?.telegram_poll_minutes ?? 15)}
          onChange={(e) => save({ telegram_poll_minutes: Number(e.target.value) })}
          style={{ width: 130 }}
        >
          <option value="5">5 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
    </>
  );
}

function ModelSelect({ models }: { models: OllamaModel[] }) {
  const chatModel = useAppStore((s) => s.chatModel);
  const setChatModel = useAppStore((s) => s.setChatModel);
  const persistServerDefault = (name: string) => {
    settingsApi.update({ chat_model: name }).catch(() => {
      /* server copy is best-effort; local store still drives the UI */
    });
  };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = chatModel || (models[0]?.name ?? '');

  return (
    <div className="om-model-select" ref={ref}>
      <button
        type="button"
        className="om-model-select-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="mono om-model-select-val">{current || 'No models'}</span>
        <Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div className="om-model-select-menu" role="listbox" data-lenis-prevent>
          {models.map((m) => (
            <button
              key={m.name}
              type="button"
              role="option"
              aria-selected={current === m.name}
              className={`om-model-select-opt mono${current === m.name ? ' active' : ''}`}
              onClick={() => {
                setChatModel(m.name);
                persistServerDefault(m.name);
                setOpen(false);
              }}
            >
              <span>{m.name}</span>
              {current === m.name && <Icon name="check" size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One-click vector-index rebuild. Re-embeds every memo with the current
 *  embedding model (incl. nomic task prefixes) and purges ghost chunks left by
 *  deleted memos. Run after changing the embed model or upgrading past 2.2.x. */
function ReindexRow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await maintenanceApi.reindex();
      setResult(`${r.reindexed_memos} memos re-embedded, ${r.ghost_chunks_purged} stale chunks purged`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Reindex failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="om-setting-row">
      <div className="om-setting-row-text">
        <p>Search index</p>
        <span className="mono">{result ?? 'Rebuild embeddings for Ask Memo & related'}</span>
      </div>
      <button type="button" className="om-btn-ghost om-btn-pill" onClick={run} disabled={busy}>
        {busy ? 'Reindexing…' : 'Rebuild'}
      </button>
    </div>
  );
}


/** The Settings cards, in two columns the user arranges by dragging.
 *
 *  This replaced a hard-coded column break. The break was a constant in the
 *  source that had to be re-measured by hand whenever a card changed height,
 *  and it went stale twice in a single afternoon: once when Mesh grew, once
 *  when the scheduled-archive rows came out. Whoever is looking at the page can
 *  see the balance better than a number committed weeks earlier, so they place
 *  the cards and openMemo remembers.
 *
 *  Whole cards are draggable, with no rearrange mode to enter. Two things stop
 *  that fighting the controls inside them: the 8px activation distance the rest
 *  of the app uses, so a click stays a click, and handing the gesture back when
 *  it starts on a form control, since otherwise selecting text in an input
 *  would pick the whole card up instead.
 */
function SortableSettingsCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  // Let the control keep the gesture. dnd-kit's PointerSensor listens on this
  // wrapper, so without this a drag inside a text field selects nothing and
  // walks the card across the page instead.
  const guard = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea, select, button, a, [role="slider"], [contenteditable="true"]')) {
      e.stopPropagation();
    }
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={'om-settings-slot' + (isDragging ? ' dragging' : '')}
      onPointerDownCapture={guard}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

type CardLayout = { left: string[]; right: string[] };

function SettingsCardBoard({
  slots,
  layout,
  onLayout,
}: {
  slots: { id: string; label: string; node: React.ReactNode }[];
  layout?: CardLayout | Record<string, never>;
  onLayout: (l: CardLayout) => void;
}) {
  const known = slots.map((s) => s.id);
  const saved = layout && Array.isArray((layout as CardLayout).left) ? (layout as CardLayout) : null;

  // A saved layout is a preference, not a schema. Ids that no longer exist get
  // dropped and cards it has never heard of are appended, so shipping or
  // removing a card cannot leave the page missing one.
  const clean = (ids: string[] | undefined) => (ids ?? []).filter((id) => known.includes(id));
  let left = clean(saved?.left);
  let right = clean(saved?.right);
  if (!saved) {
    const half = Math.ceil(known.length / 2);
    left = known.slice(0, half);
    right = known.slice(half);
  } else {
    const placed = new Set([...left, ...right]);
    right = [...right, ...known.filter((id) => !placed.has(id))];
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const byId = (id: string) => slots.find((s) => s.id === id);
  const colOf = (id: string): 'left' | 'right' => (left.includes(id) ? 'left' : 'right');

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = colOf(activeId);
    // Dropping on a column's empty space targets the column; dropping on a card
    // targets that card's column and position.
    const to: 'left' | 'right' =
      overId === 'col-left' ? 'left' : overId === 'col-right' ? 'right' : colOf(overId);
    const next: CardLayout = { left: [...left], right: [...right] };
    next[from] = next[from].filter((id) => id !== activeId);
    const target = next[to];
    const at = target.indexOf(overId);
    target.splice(at === -1 ? target.length : at, 0, activeId);
    onLayout(next);
  };

  const column = (which: 'left' | 'right', ids: string[]) => (
    <SortableContext id={'col-' + which} items={ids} strategy={verticalListSortingStrategy}>
      <div className="om-settings-col">
        {ids.map((id) => {
          const slot = byId(id);
          return slot ? (
            <SortableSettingsCard key={id} id={id}>
              {slot.node}
            </SortableSettingsCard>
          ) : null;
        })}
      </div>
    </SortableContext>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="om-settings-board">
        {column('left', left)}
        {column('right', right)}
      </div>
    </DndContext>
  );
}

export function SettingsPage() {
  const t = useAppStore((s) => s.tweaks);
  const setAppearancePanelOpen = useAppStore((s) => s.setAppearancePanelOpen);
  const openGuide = useAppStore((s) => s.openGuide);
  const showNotice = useAppStore((s) => s.showNotice);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const openAppearance = () => {
    // The live-preview panel is a desktop side panel. On mobile, point the user
    // to what they CAN do here (switch theme from the menu) and to the desktop
    // app for the rest, rather than opening a cramped, half-broken panel.
    if (isMobile) {
      showNotice(
        'Appearance editing — accent, background, layout, columns — is desktop only. On mobile you can still switch light/dark from the menu. Open openMemo on a larger screen to customize the rest.',
        'info',
      );
      return;
    }
    navigate('/');
    setTimeout(() => setAppearancePanelOpen(true), 280);
  };
  const [version, setVersion] = useState('');
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  // null = still loading (skeleton); [] = loaded, none installed.
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [backing, setBacking] = useState<'structure' | 'essential' | 'full' | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null);
  const [maxUploadSaved, setMaxUploadSaved] = useState(false);
  const [profile, setProfile] = useState<AppSettings | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [localizing, setLocalizing] = useState(false);
  const [localizeResult, setLocalizeResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    systemApi
      .health()
      .then((d) => {
        setVersion(d.version || '');
        setOllamaConnected(d.ollama_connected);
        // Check GitHub for a newer release (best-effort).
        fetch('https://api.github.com/repos/izored/OpenMemo/releases/latest')
          .then((r) => (r.ok ? r.json() : null))
          .then((rel) => {
            const latest = rel?.tag_name?.replace(/^v/, '');
            if (latest && d.version && cmpVersion(latest, d.version) > 0) {
              setUpdateAvailable(true);
            }
          })
          .catch(() => {});
      })
      .catch(() => setOllamaConnected(false));
    systemApi.models().then((d) => setOllamaModels(d.models || [])).catch(() => setOllamaModels([]));
    systemApi.stats(true).then(setStats).catch(() => setStats(null));
    settingsApi.get()
      .then((s) => {
        setMaxUploadMb(s.max_upload_mb);
        setProfile(s);
      })
      .catch(() => {
        setMaxUploadMb(5120);
        setProfile({ max_upload_mb: 5120, display_name: '', email: '', avatar_data_url: '', mailing_list_consent: false, auto_download_audio: true, auto_download_video: true, music_quality: '16', music_provider: 'qobuz', chat_model: '', num_ctx: 0, yt_cookies_present: false, bg_image_ext: '', hidden_passcode_set: false, telegram_enabled: false, telegram_poll_minutes: 15, telegram_default_collection: 'IG Inbox', telegram_force_localize: true, telegram_token_present: false, telegram_user_locked: false, mesh_enabled: false, mesh_reachable: false, settings_card_layout: {} });
      });
  }, []);

  const saveProfile = async (patch: Partial<AppSettings>) => {
    try {
      const next = await settingsApi.update(patch);
      setProfile(next);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      alert('Image too large. Max 2 MB before resize.');
      e.target.value = '';
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale to a 256px square JPEG so settings.json stays small.
        const size = 256;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        const dataUrl = c.toDataURL('image/jpeg', 0.82);
        saveProfile({ avatar_data_url: dataUrl });
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(f);
    e.target.value = '';
  };

  const runLocalize = async () => {
    if (localizing) return;
    if (!confirm('Download remote images in all saved articles to local copies? This may take a while for large libraries.')) return;
    setLocalizing(true);
    setLocalizeResult(null);
    try {
      const r = await maintenanceApi.localize();
      setLocalizeResult(`${r.images_localized} images across ${r.memos_updated} memos`);
    } catch {
      setLocalizeResult('Failed — see server logs');
    } finally {
      setLocalizing(false);
    }
  };

  const saveMaxUpload = async () => {
    if (maxUploadMb == null || !Number.isFinite(maxUploadMb)) return;
    const clamped = Math.max(1, Math.min(Math.round(maxUploadMb), 50 * 1024));
    try {
      const s = await settingsApi.update({ max_upload_mb: clamped });
      setMaxUploadMb(s.max_upload_mb);
      setMaxUploadSaved(true);
      setTimeout(() => setMaxUploadSaved(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleBackup = async (scope: 'structure' | 'essential' | 'full') => {
    setBacking(scope);
    try {
      await backupApi.download(scope);
    } catch (err) {
      alert(`Backup failed: ${(err as Error).message}`);
    } finally {
      setBacking(null);
    }
  };

  const handleRestoreClick = () => {
    if (!confirm('Restore will overwrite all current data from the backup file. This cannot be undone. Continue?')) return;
    if (!confirm('Final confirmation: restore workspace from this backup?')) return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    try {
      await backupApi.restore(file);
      alert('Restore complete. Reloading.');
      location.reload();
    } catch (err) {
      alert(`Restore failed: ${(err as Error).message}`);
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  // Always pulse in dev so the update flow is visible while building.
  const showUpdateDot = updateAvailable || import.meta.env.DEV;

  // Each card is one draggable unit. The JSX is unchanged from when these
  // were plain siblings; only the wrapper moved. Order here is the fallback
  // used until the user arranges them, and any card missing from a saved
  // layout is appended from this list, so a new card can never be stranded.
  const cardSlots: { id: string; label: string; node: React.ReactNode }[] = [
    { id: 'profile', label: 'Profile', node: (
      <>
          {!profile && (
              <SettingCard title="Profile" eyebrow="You">
                <div className="om-profile-grid">
                  <span className="om-skel avatar" />
                  <div className="om-profile-fields">
                    <label className="om-profile-field">
                      <span className="mono">Display name</span>
                      <span className="om-skel ctrl" style={{ width: '100%' }} />
                    </label>
                    <label className="om-profile-field">
                      <span className="mono">Email</span>
                      <span className="om-skel ctrl" style={{ width: '100%' }} />
                    </label>
                  </div>
                </div>
                <div className="om-profile-consent" aria-hidden>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                    <span className="om-skel line" />
                    <span className="om-skel line short" />
                  </div>
                </div>
              </SettingCard>
            )}
          {profile && (
              <SettingCard title="Profile" eyebrow="You">
                <div className="om-profile-grid">
                  <button
                    className="om-profile-avatar"
                    onClick={() => avatarInputRef.current?.click()}
                    title="Change profile picture"
                    style={profile.avatar_data_url ? { backgroundImage: `url(${profile.avatar_data_url})` } : undefined}
                  >
                    {!profile.avatar_data_url && (
                      <span>{(profile.display_name || 'You').slice(0, 2).toUpperCase()}</span>
                    )}
                    <span className="om-profile-avatar-edit"><Icon name="image" size={12} /></span>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={pickAvatar}
                  />
                  <div className="om-profile-fields">
                    <label className="om-profile-field">
                      <span className="mono">Display name</span>
                      <input
                        className="om-input"
                        type="text"
                        value={profile.display_name}
                        placeholder="Your name"
                        onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                        onBlur={() => saveProfile({ display_name: profile.display_name })}
                      />
                    </label>
                    <label className="om-profile-field">
                      <span className="mono">Email</span>
                      <input
                        className="om-input"
                        type="email"
                        value={profile.email}
                        placeholder="you@example.com"
                        onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                        onBlur={() => saveProfile({ email: profile.email })}
                      />
                    </label>
                  </div>
                </div>
                <label className="om-profile-consent">
                  <input
                    type="checkbox"
                    checked={profile.mailing_list_consent}
                    onChange={(e) => saveProfile({ mailing_list_consent: e.target.checked })}
                  />
                  <div>
                    <p>Personal email list</p>
                    <span className="mono">
                      Hear about openMemo updates and new apps from the creator. No marketing third parties.
                    </span>
                  </div>
                </label>
                {profileSaved && <span className="mono om-profile-saved">Saved ✓</span>}
              </SettingCard>
            )}

      </>
    ) },
    { id: 'local-ai', label: 'Local AI', node: (
      <>
            <SettingCard title="Local AI" eyebrow="Ollama">
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Connection</p>
                  <span className="mono">Powers chat, RAG, embeddings</span>
                </div>
                {ollamaConnected === null ? (
                  <span className="om-skel sm" />
                ) : (
                  <span className="mono om-setting-val" style={{ color: ollamaConnected ? 'var(--accent)' : '#EF5048' }}>
                    {ollamaConnected ? 'Connected' : 'Offline'}
                  </span>
                )}
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Default model</p>
                  <span className="mono">Used across chat and Ask</span>
                </div>
                {ollamaModels === null ? <span className="om-skel ctrl" /> : <ModelSelect models={ollamaModels} />}
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Context window</p>
                  <span className="mono">Tokens per AI call (num_ctx). 0 = default (8192). Raise for long transcripts if your RAM allows.</span>
                </div>
                {profile === null ? (
                  <span className="om-skel ctrl" style={{ width: 160 }} />
                ) : (
                  <div className="om-inline-control">
                    <input
                      type="number"
                      min={0}
                      max={131072}
                      step={1024}
                      value={profile.num_ctx || ''}
                      placeholder="8192"
                      onChange={(e) => setProfile({ ...profile, num_ctx: e.target.value === '' ? 0 : Number(e.target.value) })}
                      onBlur={() => saveProfile({ num_ctx: profile.num_ctx })}
                      className="om-input"
                      style={{ width: 96, textAlign: 'right' }}
                    />
                    <span className="mono om-setting-val">tokens</span>
                  </div>
                )}
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Installed</p>
                  {ollamaModels === null ? (
                    <span className="om-skel" />
                  ) : (
                    <span className="mono">{ollamaModels.length} model{ollamaModels.length === 1 ? '' : 's'} pulled locally</span>
                  )}
                </div>
                {ollamaModels === null ? <span className="om-skel sm" /> : <span className="mono om-setting-val">{ollamaModels.length}</span>}
              </div>
              <ReindexRow />
            </SettingCard>

      </>
    ) },
    { id: 'files', label: 'Files & limits', node: (
      <>
            <SettingCard title="Files & limits" eyebrow="Files">
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Max upload size</p>
                  <span className="mono">Per file. Any file type is accepted. Default 5120 MB (5 GB).</span>
                </div>
                {profile === null ? (
                  <span className="om-skel ctrl" style={{ width: 200 }} />
                ) : (
                  <div className="om-inline-control">
                    <input
                      type="number"
                      min={1}
                      max={51200}
                      value={maxUploadMb ?? ''}
                      onChange={(e) => setMaxUploadMb(e.target.value === '' ? null : Number(e.target.value))}
                      className="om-input"
                      style={{ width: 92, textAlign: 'right' }}
                    />
                    <span className="mono om-setting-val">MB</span>
                    <button className="om-btn-secondary" onClick={saveMaxUpload} disabled={maxUploadMb == null}>
                      {maxUploadSaved ? 'Saved ✓' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="om-setting-row-text">
                  <p>Auto-download pulled audio</p>
                  <span className="mono">
                    Download audio from SoundCloud, Bandcamp, etc. on save so it plays locally and survives takedown. When off, the memo streams via the platform's embed instead.
                  </span>
                </div>
                <button
                  type="button"
                  className="om-add-toggle"
                  onClick={() => profile && saveProfile({ auto_download_audio: !profile.auto_download_audio })}
                  aria-pressed={profile?.auto_download_audio ?? true}
                >
                  <span className={'om-add-toggle-switch' + ((profile?.auto_download_audio ?? true) ? ' on' : '')}>
                    <span className="om-add-toggle-knob" />
                  </span>
                </button>
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="om-setting-row-text">
                  <p>Auto-download embed-less video</p>
                  <span className="mono">
                    Download video that has no inline player (Threads, Reddit, unknown hosts) on save so it plays locally and survives takedown. Embeddable hosts (YouTube, Vimeo, …) stay remote so this won't fill the disk.
                  </span>
                </div>
                <button
                  type="button"
                  className="om-add-toggle"
                  onClick={() => profile && saveProfile({ auto_download_video: !profile.auto_download_video })}
                  aria-pressed={profile?.auto_download_video ?? true}
                >
                  <span className={'om-add-toggle-switch' + ((profile?.auto_download_video ?? true) ? ' on' : '')}>
                    <span className="om-add-toggle-knob" />
                  </span>
                </button>
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="om-setting-row-text">
                  <p>Localize saved content</p>
                  <span className="mono">
                    {localizeResult || 'Download remote images in saved articles so memos survive source deletion'}
                  </span>
                </div>
                <button className="om-btn-secondary" onClick={runLocalize} disabled={localizing}>
                  {localizing ? 'Localizing…' : 'Localize'}
                </button>
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <div className="om-setting-row-text" style={{ maxWidth: 560 }}>
                  <p>Cookies for restricted downloads</p>
                  <span className="mono">
                    Lets "Make it local" fetch age-restricted or private videos, and unlocks full-resolution uncropped Instagram photos (without cookies, Instagram only serves a 640px square crop). The cookie file stays on this machine, in openMemo's own data store (a Docker volume), as <code>yt_cookies.txt</code>. It is only handed to yt-dlp and gallery-dl to fetch media, never sent to any openMemo service (there isn't one). Use a throwaway account.{' '}
                    <button type="button" onClick={() => openGuide('yt-cookies')} style={{ color: 'var(--accent)', fontWeight: 500 }}>Show me how</button>
                  </span>
                </div>
                <CookiesUpload />
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8, flexDirection: 'column', alignItems: 'stretch' }}>
                <InstagramConnectRows />
                <MusicRelayRows />
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <TrashRow />
              </div>
            </SettingCard>

      </>
    ) },
    { id: 'extension', label: 'Browser extension', node: (
      <>
            <SettingCard title="Browser extension" eyebrow="Capture">
              <div className="om-ext-card-body">
                <div className="om-ext-cta">
                  <p className="om-ext-cta-sub">
                    Save pages, highlight text, or clip tabs directly from your browser. Load unpacked from <code>chrome-extension/</code> in the repo.
                  </p>
                  <a
                    className="om-ext-install-btn"
                    href="https://github.com/izored/OpenMemo/tree/main/chrome-extension"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="arrowUpRight" size={13} />
                    Install extension
                  </a>
                </div>
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  whileInView={{ y: 0, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <div className="om-ext-mockup">
                    <div className="om-ext-mockup-header">
                      <div className="om-ext-mockup-logo">O</div>
                      <span className="om-ext-mockup-title">OpenMemo</span>
                      <div className="om-ext-mockup-dot" />
                    </div>
                    <div className="om-ext-mockup-body">
                      <div className="om-ext-mockup-preview">
                        <div className="om-ext-mockup-line" />
                        <div className="om-ext-mockup-line short" />
                      </div>
                      <div className="om-ext-mockup-btn" />
                    </div>
                  </div>
                </motion.div>
              </div>
            </SettingCard>


            {/* Column break. Measured at 1280px after scheduled archives were
                removed: the cards above total 2637px and the cards from here down
                2527px, so the columns land 110px apart. Re-measure and move this
                whenever a card is added, removed, or changes height — see
                CLAUDE.md. Dropping the archive UI shrank Backup & Restore by
                ~1100px and flipped the balance, which is exactly why. */}
      </>
    ) },
    { id: 'phone', label: 'Phone capture', node: (
      <>
            <SettingCard title="Phone capture" eyebrow="Telegram relay">
              <TelegramRelayRows profile={profile} save={saveProfile} />
            </SettingCard>

      </>
    ) },
    { id: 'mesh', label: 'Mesh', node: (
      <>
            <SettingCard title="Mesh" eyebrow="Two-way device sync">
              <MeshRows profile={profile} save={saveProfile} />
            </SettingCard>


      </>
    ) },
    { id: 'backup', label: 'Backup & Restore', node: (
      <>
            <SettingCard title="Backup & Restore" eyebrow="Data safety">
              <LibraryIntegrityRows />
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Structure backup</p>
                  <span className="mono">DB, collections, tags, chats — no uploaded files</span>
                </div>
                <button className="om-btn-secondary" onClick={() => handleBackup('structure')} disabled={!!backing || restoring}>
                  {backing === 'structure' ? 'Preparing…' : 'Download'}
                </button>
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Essential backup</p>
                  <span className="mono">DB + every file with no source — the part that exists nowhere else</span>
                </div>
                <button className="om-btn-secondary" onClick={() => handleBackup('essential')} disabled={!!backing || restoring}>
                  {backing === 'essential' ? 'Preparing…' : 'Download'}
                </button>
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Full backup</p>
                  <span className="mono">DB + all uploaded files</span>
                </div>
                <button className="om-btn-secondary" onClick={() => handleBackup('full')} disabled={!!backing || restoring}>
                  {backing === 'full' ? 'Preparing…' : 'Download'}
                </button>
              </div>
              <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
                <div className="om-setting-row-text">
                  <p>Restore from backup</p>
                  <span className="mono">Upload a .zip — overwrites current data</span>
                </div>
                <button className="om-btn-secondary danger" onClick={handleRestoreClick} disabled={!!backing || restoring}>
                  {restoring ? 'Restoring…' : 'Restore'}
                </button>
                <input type="file" ref={fileInputRef} accept=".zip" style={{ display: 'none' }} onChange={handleFileSelected} />
              </div>
            </SettingCard>

      </>
    ) },
    { id: 'danger', label: 'Danger zone', node: (
      <>
            <SettingCard title="Danger zone" eyebrow="Careful">
              <div className="om-danger-grid">
                <div className="om-setting-row">
                  <div className="om-setting-row-text">
                    <p>Export all Memos</p>
                    <span className="mono">JSON · Markdown bundle</span>
                  </div>
                  <a className="om-btn-secondary" href="/api/export/markdown" target="_blank" rel="noopener noreferrer">Export</a>
                </div>
                <div className="om-setting-row">
                  <div className="om-setting-row-text">
                    <p>Delete cached previews</p>
                    <span className="mono">{stats?.storage ? `Frees ~${fmtBytes(stats.storage.cache_bytes)}` : 'Thumbnail cache'}</span>
                  </div>
                  <button
                    className="om-btn-secondary"
                    onClick={async () => {
                      if (!confirm('Delete all cached thumbnail previews? They re-cache automatically.')) return;
                      try {
                        const r = await maintenanceApi.clearCache();
                        systemApi.stats(true).then(setStats).catch(() => {});
                        alert(`Cleared ${fmtBytes(r.freed_bytes)} of cached previews.`);
                      } catch { alert('Failed to clear cache.'); }
                    }}
                  >Clear</button>
                </div>
                <div className="om-setting-row">
                  <div className="om-setting-row-text">
                    <p>Reset workspace</p>
                    <span className="mono">Cannot be undone</span>
                  </div>
                  <button
                  className="om-btn-secondary danger"
                  onClick={async () => {
                    if (!confirm('Permanently delete ALL Memos, collections, tags, chats and files? This cannot be undone.')) return;
                    if (!confirm('Final confirmation. Reset the entire workspace?')) return;
                    try {
                      await maintenanceApi.reset();
                      alert('Workspace reset. Reloading.');
                      location.reload();
                    } catch { alert('Failed to reset workspace.'); }
                  }}
                >Reset</button>
                </div>
              </div>
            </SettingCard>


          {/* ── Built with — full-width auto-scroll marquee ─────── */}
      </>
    ) },
    { id: 'about', label: 'About', node: (
      <>
          <SettingCard title="Built with ❤️" eyebrow="Open source">
            <BuiltWith entries={BUILT_WITH} />
          </SettingCard>
          {/* Credits last — about-the-app cards belong after the functional
              ones, not wedged between sync and data safety. */}
          <div className="om-setting-card om-creator-card">
            <div className="om-setting-head">
              <span className="mono om-setting-eyebrow">Made by</span>
            </div>
            <div className="om-setting-body">
              <p className="om-creator-name">Reda Izo</p>
              <span className="om-creator-role">Creative Director · openMemo</span>
              <p className="om-creator-bio">
                I build tools I want to use. openMemo keeps the links, files,
                notes and videos worth saving. On your machine.
              </p>
              <div className="om-creator-links">
                <a className="om-creator-link" href="https://dev.izo.red" target="_blank" rel="noopener noreferrer">
                  <Icon name="globe" size={12} /> dev.izo.red
                </a>
                <a className="om-creator-link" href="https://github.com/izored/OpenMemo" target="_blank" rel="noopener noreferrer">
                  <Icon name="github" size={12} /> GitHub
                </a>
              </div>
            </div>
          </div>
      </>
    ) },
  ];

  return (
    <div className="om-settings">
      <PageHeader
        eyebrow="Workspace · Personal"
        title="Settings"
        sub="Everything here is stored on your machine. No cloud, no account."
      />

      <div className="om-bento-stack">

        {/* ── Appearance hero — the headline feature ──────────── */}
        <div
          className="om-ap-hero"
          role="button"
          tabIndex={0}
          onClick={openAppearance}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openAppearance();
            }
          }}
        >
          <div className="om-ap-hero-text">
            <span className="mono om-ap-hero-eyebrow">Look &amp; feel · Live preview</span>
            <h2 className="om-ap-hero-title">Make openMemo yours.</h2>
            <p className="om-ap-hero-sub">
              Theme, accent, card style, layout, columns, background. Tweak it and watch every Memo update live.
            </p>
            <div className="om-ap-hero-actions">
              <span className="om-ap-hero-cta">
                {isMobile ? 'Desktop only — tap for details' : 'Open live preview'} <Icon name="arrowUpRight" size={15} />
              </span>
              <button
                type="button"
                className="om-ap-hero-tour"
                onClick={(e) => {
                  e.stopPropagation();
                  localStorage.removeItem(ONBOARDING_KEY);
                  window.dispatchEvent(new Event('openmemo:retake-tour'));
                }}
              >
                Replay product tour
              </button>
            </div>
          </div>
          <div className="om-ap-hero-vis" aria-hidden>
            <div className="om-ap-hero-window">
              <div className="om-ap-hero-window-bar">
                <span /><span /><span />
              </div>
              <div className="om-ap-hero-window-body">
                <span className="om-ap-hero-accent" style={{ background: t.accent }} />
                <span className="om-ap-hero-mini" />
                <span className="om-ap-hero-mini" />
                <span className="om-ap-hero-mini" />
                <span className="om-ap-hero-mini" />
              </div>
            </div>
            <span className="om-ap-hero-state mono">
              {t.theme} · {t.cardStyle} · {t.layout} · {t.gridColumns} cols
            </span>
          </div>
        </div>

        {/* ── Stats strip — big numbers. Tiles always render (with skeleton
              loaders) so the row reserves its height and never jumps in. ── */}
        <div className="om-stat-strip">
          <div className="om-stat-tile">
            {stats ? <span className="om-stat-num">{stats.total_memos.toLocaleString()}</span> : <span className="om-stat-skel" />}
            <span className="om-stat-lbl">Memos</span>
          </div>
          <div className="om-stat-tile">
            {stats ? <span className="om-stat-num">{stats.total_collections}</span> : <span className="om-stat-skel" />}
            <span className="om-stat-lbl">Collections</span>
          </div>
          <div className="om-stat-tile">
            {stats ? <span className="om-stat-num">{stats.total_tags}</span> : <span className="om-stat-skel" />}
            <span className="om-stat-lbl">Tags</span>
          </div>
          <div className="om-stat-tile">
            {stats ? <span className="om-stat-num">{stats.memos_this_week}</span> : <span className="om-stat-skel" />}
            <span className="om-stat-lbl">This week</span>
          </div>
          <div className="om-stat-tile om-stat-storage">
            <div className="om-stat-storage-top">
              {stats?.storage ? <span className="om-stat-num">{fmtBytes(stats.storage.total_bytes)}</span> : <span className="om-stat-skel" />}
              <span className="om-stat-lbl">On disk</span>
            </div>
            {stats?.storage ? (
              <>
                <div className="om-storage-bar" aria-hidden>
                  <span className="a" style={{ width: `${(stats.storage.files_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%` }} />
                  <span className="b" style={{ width: `${(stats.storage.cache_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%` }} />
                </div>
                <div className="om-storage-legend mono">
                  <span><i className="a" /> Files {fmtBytes(stats.storage.files_bytes)}</span>
                  <span><i className="b" /> Cache {fmtBytes(stats.storage.cache_bytes)}</span>
                  <span>DB {fmtBytes(stats.storage.db_bytes)}</span>
                </div>
              </>
            ) : (
              <span className="om-stat-skel wide" />
            )}
          </div>
        </div>

        {/* ── Cards — masonry so short cards get hugged, no gaps ─ */}
        {/* Cards — two columns the user arranges by dragging (see
            SortableSettingsCard). The old hand-placed om-col-break is gone: it
            was a constant in the source that went stale whenever a card changed
            height, and the person looking at the page can judge it better. */}
        <SettingsCardBoard
          slots={cardSlots}
          layout={profile?.settings_card_layout}
          onLayout={(l) => saveProfile({ settings_card_layout: l })}
        />

      </div>

      <div className="om-settings-footer">
        <a
          className="om-creator-link"
          href="mailto:dev@izo.red?subject=[openMemo Feedback]&body=Hi Reda,%0A%0A"
        >
          <Icon name="message" size={12} /> Feedback
        </a>

        <button
          className="om-version-btn"
          onClick={() => setChangelogOpen(true)}
          title={showUpdateDot ? 'Update available' : 'Up to date'}
        >
          openMemo · v{version || '...'}
          {showUpdateDot && <span className="om-update-dot" />}
        </button>

        <button className="om-creator-link" onClick={() => setChangelogOpen(true)}>
          <Icon name="sparkles" size={12} /> Changelog
        </button>
      </div>

      {changelogOpen && (
        <ChangelogModal current={version || '0.0.0'} onClose={() => setChangelogOpen(false)} />
      )}
    </div>
  );
}
