import { useEffect, useState } from 'react';
import {
  Settings, Moon, Sun, Loader2, Wifi, WifiOff,
  ChevronDown, ChevronUp, Globe, AlertTriangle,
  Download, Puzzle, Mail,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { systemApi } from '@/lib/api';
import type { OllamaModel } from '@/types';

type Stats = {
  total_memos: number;
  total_collections: number;
  total_tags: number;
  memos_this_week: number;
  by_type: Record<string, number>;
};

const TYPE_EMOJI: Record<string, string> = {
  note: '📝', article: '📄', video: '🎬', image: '🖼️',
  link: '🔗', document: '📁', audio: '🎵',
};

export function SettingsPage() {
  const { theme, setTheme, dashboardGridColumns, setDashboardGridColumns } = useAppStore();
  const [version, setVersion] = useState<string>('');
  const [versionLoading, setVersionLoading] = useState(true);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(true);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    systemApi.health()
      .then((data) => {
        setVersion(data.version || '');
        setOllamaConnected(data.ollama_connected);
      })
      .catch(() => { setVersion(''); setOllamaConnected(false); })
      .finally(() => { setVersionLoading(false); setOllamaLoading(false); });

    systemApi.models()
      .then((data) => setOllamaModels(data.models || []))
      .catch(() => setOllamaModels([]));

    systemApi.stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const refreshOllama = () => {
    setOllamaLoading(true);
    setOllamaModels([]);
    systemApi.health()
      .then((data) => setOllamaConnected(data.ollama_connected))
      .catch(() => setOllamaConnected(false))
      .finally(() => setOllamaLoading(false));
    systemApi.models()
      .then((data) => setOllamaModels(data.models || []))
      .catch(() => setOllamaModels([]));
  };

  const socialLink = (href: string, icon: React.ReactNode, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/30 transition-colors font-medium"
    >
      {icon}{label}
    </a>
  );

  const shortcuts = [
    { key: '/', desc: 'Focus search' },
    { key: 'N', desc: 'New memo' },
    { key: 'Esc', desc: 'Close panel / modal' },
    { key: '⌘ K', desc: 'Command palette' },
    { key: '⌘ /', desc: 'Toggle sidebar' },
    { key: '⌘ D', desc: 'Toggle dark mode' },
  ];

  const label = (text: string) => (
    <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-5">{text}</p>
  );

  return (
    <div className="max-w-5xl mx-auto pt-8 pb-4 px-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-active)] flex items-center justify-center">
          <Settings size={24} className="text-[var(--color-text-active)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Settings</h1>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-1">Customize your OpenMemo experience</p>
        </div>
      </div>

      {/* ── Stats card — full width ── */}
      <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm mb-5">
        {label('Your Library')}
        {stats ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-4">
              {[
                { value: stats.total_memos, label: 'Memos' },
                { value: stats.total_collections, label: 'Collections' },
                { value: stats.total_tags, label: 'Tags' },
                { value: stats.memos_this_week, label: 'This week' },
              ].map((s) => (
                <div key={s.label} className="bg-[var(--color-bg-hover)] rounded-2xl p-4 text-center">
                  <p className="text-2xl font-bold text-[var(--color-text)]">{s.value}</p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {Object.keys(stats.by_type).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.by_type).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-bg-hover)] text-[13px] text-[var(--color-text-secondary)]"
                  >
                    <span>{TYPE_EMOJI[type] ?? '📌'}</span>
                    <span className="capitalize font-medium">{type}</span>
                    <span className="text-[var(--color-text-muted)]">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[13px]">Loading stats…</span>
          </div>
        )}
      </div>

      {/* ── Row: Appearance + Ollama ── */}
      <div className="grid grid-cols-2 gap-5 mb-5">

      
        {/* Appearance */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          {label('Appearance')}

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)] mb-0.5">Theme</h3>
              <p className="text-[13px] text-[var(--color-text-secondary)]">Light or dark mode</p>
            </div>

            <div className="flex gap-2 bg-[var(--color-bg-hover)] rounded-full p-1">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all',
                  theme === 'light'
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                <Sun size={15} /> Light
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all',
                  theme === 'dark'
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                <Moon size={15} /> Dark
              </button>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-[var(--color-border)] flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0 pr-2">
              <h3 className="text-base font-bold text-[var(--color-text)] mb-0.5">Dashboard grid</h3>
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Choose how many memo cards <br /> show per row on large screens
              </p>
            </div>

            <div className="flex-shrink-0 flex gap-2 bg-[var(--color-bg-hover)] rounded-full p-1 min-w-[96px] justify-center">
              <button
                onClick={() => setDashboardGridColumns(4)}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-full text-sm font-semibold transition-all',
                  dashboardGridColumns === 4
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                4
              </button>

              <button
                onClick={() => setDashboardGridColumns(5)}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-full text-sm font-semibold transition-all',
                  dashboardGridColumns === 5
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                5
              </button>
            </div>
          </div>
        </div>

        {/* Ollama */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          {label('Ollama')}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[var(--color-text)] mb-0.5">Local AI</h3>
              <p className="text-[13px] text-[var(--color-text-secondary)]">Powers chat, RAG, and embeddings</p>
            </div>
            <div className="flex items-center gap-3">
              {ollamaLoading ? (
                <Loader2 size={15} className="animate-spin text-[var(--color-text-muted)]" />
              ) : ollamaConnected ? (
                <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[13px] font-semibold">
                  <Wifi size={12} /> Connected
                </span>
              ) : (
                <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 text-[13px] font-semibold">
                  <WifiOff size={12} /> Offline
                </span>
              )}
              <button onClick={refreshOllama} className="text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] transition-colors font-medium">
                Refresh
              </button>
            </div>
          </div>
          {ollamaConnected && (
            <div className="border-t border-[var(--color-border)] pt-4">
              <button
                onClick={() => setModelsExpanded((v) => !v)}
                className="w-full flex items-center justify-between text-[13px] font-semibold text-[var(--color-text)] hover:text-[var(--color-brand)] transition-colors"
              >
                <span>{ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''} available</span>
                {modelsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {modelsExpanded && ollamaModels.length > 0 && (
                <div className="mt-3 space-y-2">
                  {ollamaModels.map((m) => (
                    <div key={m.name} className="flex items-center justify-between px-3 py-2 rounded-2xl bg-[var(--color-bg-hover)]">
                      <span className="font-mono text-[12px] text-[var(--color-text)]">{m.name}</span>
                      {m.size && <span className="text-[11px] text-[var(--color-text-muted)]">{(m.size / 1e9).toFixed(1)} GB</span>}
                    </div>
                  ))}
                </div>
              )}
              {modelsExpanded && ollamaModels.length === 0 && (
                <p className="mt-3 text-[12px] text-[var(--color-text-muted)]">No models. Run <code className="font-mono">ollama pull llama3.2</code></p>
              )}
            </div>
          )}
          {!ollamaConnected && !ollamaLoading && (
            <div className="border-t border-[var(--color-border)] pt-4">
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Start with <code className="font-mono text-[var(--color-text)]">ollama serve</code> then refresh.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Row: Feedback + Chrome Extension ── */}
      <div className="grid grid-cols-2 gap-5 mb-5">

        {/* Feedback */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          {label('Feedback')}
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-[var(--color-bg-hover)] flex items-center justify-center flex-shrink-0">
              <Mail size={18} className="text-[var(--color-text-secondary)]" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-[var(--color-text)] mb-1">Send Feedback</h3>
              <p className="text-[13px] text-[var(--color-text-secondary)] mb-4 leading-relaxed">
                Found a bug? Have an idea? I'd love to hear it.
              </p>
              <a
                href="mailto:dev@izo.red?subject=[OpenMemo Feedback]&body=Hi Reda,%0A%0A"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-brand)] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
              >
                <Mail size={13} /> Send a message
              </a>
            </div>
          </div>
        </div>

        {/* Chrome Extension */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          {label('Save from anywhere')}
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-2xl bg-[var(--color-bg-hover)] flex items-center justify-center flex-shrink-0">
              <Puzzle size={18} className="text-[var(--color-text-secondary)]" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-[var(--color-text)] mb-1">Chrome Extension</h3>
              <p className="text-[13px] text-[var(--color-text-secondary)] mb-4 leading-relaxed">
                Clip articles, links, and pages to OpenMemo <br /> Directly from Chrome.
              </p>
              <a
                href="https://github.com/izored/openmemo"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/40 transition-colors"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Keyboard Shortcuts — full width ── */}
      <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm mb-5">
        {label('Keyboard Shortcuts')}
        <div className="grid grid-cols-3 gap-3">
          {shortcuts.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-[var(--color-bg-hover)]"
            >
              <span className="text-[13px] text-[var(--color-text-secondary)]">{s.desc}</span>
              <kbd className="px-2 py-0.5 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[12px] font-mono text-[var(--color-text)] shadow-sm">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      {/* ── Danger Zone — full width ── */}
      <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm border border-red-500/10 mb-5">
        {label('Danger Zone')}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-red-500" />
          </div>
          <div className="flex-1">
            <p className="text-[13px] text-[var(--color-text-secondary)] mb-5 leading-relaxed">
              Export a backup before making any destructive changes.
            </p>
            <div className="flex gap-3">
              <a
                href="/api/export/markdown"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/40 transition-colors"
              >
                <Download size={13} /> Export all memos
              </a>
              <button
                disabled
                title="Coming soon"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-red-500/20 text-[13px] font-semibold text-red-400/50 cursor-not-allowed"
              >
                Clear all data
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom row: Made By + Built With ── */}
      <div className="grid grid-cols-2 gap-5 mb-5 items-start">

        {/* Made By */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          {label('Made By')}
          <div className="flex gap-4 items-start">
            {avatarError ? (
              <div className="w-12 h-12 rounded-full bg-[var(--color-brand)] flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">RI</span>
              </div>
            ) : (
              <img
                src="/Reda-Izo-Portrait-500px.jpg"
                alt="Reda Izo"
                onError={() => setAvatarError(true)}
                className="w-12 h-12 rounded-full object-cover object-top flex-shrink-0 ring-2 ring-[var(--color-border)]"
              />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-[var(--color-text)]">Reda Izo</h3>
              <p className="text-[12px] text-[var(--color-text-muted)] mb-3">Creative Director · Photography + CGI & Motion</p>
              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed mb-4">
                As a creative director I collect constantly — references, articles, links, ideas. I kept losing things I'd already found. OpenMemo is the memory system I wanted to exist. Also, I just wanted to build an app for once.
              </p>
              <div className="flex flex-wrap gap-2">
                {socialLink('https://izo.red', <Globe size={12} />, 'izo.red')}
                {socialLink('https://github.com/izored',
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" /></svg>,
                  'izored')}
                {socialLink('https://x.com/izo_cg',
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
                  'izo_cg')}
                {socialLink('https://www.threads.net/@izo.cg',
                  <span className="text-[12px] font-bold">@</span>,
                  'izo.cg')}
              </div>
            </div>
          </div>
        </div>

        {/* Built With */}
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-7 shadow-sm">
          <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-1">Built With ❤️</p>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-5">None of this would exist without these open-source projects.</p>
          <div className="flex flex-wrap gap-2">
            {[
              { name: 'React', url: 'https://react.dev', desc: 'UI framework' },
              { name: 'Vite', url: 'https://vitejs.dev', desc: 'Build tool' },
              { name: 'Tailwind CSS', url: 'https://tailwindcss.com', desc: 'Styling' },
              { name: 'FastAPI', url: 'https://fastapi.tiangolo.com', desc: 'Backend API' },
              { name: 'SQLite', url: 'https://sqlite.org', desc: 'Database' },
              { name: 'Ollama', url: 'https://ollama.ai', desc: 'Local LLM inference' },
              { name: 'ChromaDB', url: 'https://chromadb.dev', desc: 'Vector database' },
              { name: 'TanStack Query', url: 'https://tanstack.com/query', desc: 'Data fetching' },
              { name: 'Zustand', url: 'https://github.com/pmndrs/zustand', desc: 'State management' },
              { name: 'MDXEditor', url: 'https://mdxeditor.dev', desc: 'Markdown editing' },
              { name: 'dnd-kit', url: 'https://dndkit.com', desc: 'Drag & drop' },
              { name: 'Lucide', url: 'https://lucide.dev', desc: 'Icons' },
              { name: 'Docker', url: 'https://docker.com', desc: 'Containerisation' },
            ].map((dep) => (
              <a
                key={dep.name}
                href={dep.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col px-3.5 py-2.5 rounded-2xl border border-[var(--color-border)] hover:border-[var(--color-brand)]/40 hover:text-[var(--color-brand)] transition-colors group"
              >
                <span className="text-[13px] font-semibold text-[var(--color-text)] group-hover:text-[var(--color-brand)] transition-colors">{dep.name}</span>
                <span className="text-[11px] text-[var(--color-text-muted)]">{dep.desc}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer: version ── */}
      <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-[var(--color-text-muted)]">
        <div className="w-5 h-5 rounded-full bg-[var(--color-brand)] flex items-center justify-center">
          <span className="text-white font-bold text-[10px]">O</span>
        </div>
        <span>OpenMemo</span>
        <span>·</span>
        {versionLoading ? <Loader2 size={11} className="animate-spin" /> : <span>v{version || '—'}</span>}
      </div>
    </div>
  );
}
