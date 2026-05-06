import { useEffect, useState } from 'react';
import { Settings, Moon, Sun, Loader2, Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { systemApi } from '@/lib/api';

export function SettingsPage() {
  const { theme, setTheme } = useAppStore();
  const [version, setVersion] = useState<string>('');
  const [versionLoading, setVersionLoading] = useState(true);
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<any[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(true);
  const [modelsExpanded, setModelsExpanded] = useState(false);

  useEffect(() => {
    systemApi.health()
      .then((data) => {
        setVersion(data.version || '');
        setOllamaConnected(data.ollama_connected);
      })
      .catch(() => {
        setVersion('');
        setOllamaConnected(false);
      })
      .finally(() => {
        setVersionLoading(false);
        setOllamaLoading(false);
      });

    systemApi.models()
      .then((data) => setOllamaModels(data.models || []))
      .catch(() => setOllamaModels([]));
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

  return (
    <div className="max-w-2xl mx-auto pt-8 pb-20">
      {/* Header */}
      <div className="flex items-center gap-4 mb-12">
        <div className="w-12 h-12 rounded-2xl bg-[var(--color-bg-active)] flex items-center justify-center">
          <Settings size={24} className="text-[var(--color-text-active)]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Settings</h1>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-1">Customize your OpenMemo experience</p>
        </div>
      </div>

      {/* Appearance Section */}
      <section className="mb-12">
        <h2 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-6">
          Appearance
        </h2>

        <div className="bg-[var(--color-bg-card)] rounded-3xl p-8 shadow-sm mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">Theme</h3>
              <p className="text-[14px] text-[var(--color-text-secondary)]">Choose between light and dark mode</p>
            </div>
            <div className="flex gap-2 bg-[var(--color-bg-hover)] rounded-full p-1">
              <button
                onClick={() => setTheme('light')}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all',
                  theme === 'light'
                    ? 'bg-[var(--color-bg-card)] text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                <Sun size={16} />
                Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={cn(
                  'flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all',
                  theme === 'dark'
                    ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                )}
              >
                <Moon size={16} />
                Dark
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Ollama Section */}
      <section className="mb-12">
        <h2 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-6">
          Ollama
        </h2>

        <div className="bg-[var(--color-bg-card)] rounded-3xl p-8 shadow-sm">
          {/* Status row */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)] mb-1">Local AI</h3>
              <p className="text-[14px] text-[var(--color-text-secondary)]">
                Powers chat, RAG, and embeddings via Ollama
              </p>
            </div>
            <div className="flex items-center gap-3">
              {ollamaLoading ? (
                <Loader2 size={16} className="animate-spin text-[var(--color-text-muted)]" />
              ) : ollamaConnected ? (
                <span className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[13px] font-semibold">
                  <Wifi size={13} />
                  Connected
                </span>
              ) : (
                <span className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/10 text-red-500 text-[13px] font-semibold">
                  <WifiOff size={13} />
                  Offline
                </span>
              )}
              <button
                onClick={refreshOllama}
                className="text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] transition-colors font-medium"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Models */}
          {ollamaConnected && (
            <div className="border-t border-[var(--color-border)] pt-5">
              <button
                onClick={() => setModelsExpanded((v) => !v)}
                className="w-full flex items-center justify-between text-[14px] font-semibold text-[var(--color-text)] hover:text-[var(--color-brand)] transition-colors"
              >
                <span>
                  {ollamaModels.length} model{ollamaModels.length !== 1 ? 's' : ''} available
                </span>
                {modelsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>

              {modelsExpanded && ollamaModels.length > 0 && (
                <div className="mt-4 space-y-2">
                  {ollamaModels.map((m: any) => (
                    <div
                      key={m.name}
                      className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-[var(--color-bg-hover)]"
                    >
                      <span className="font-mono text-[13px] text-[var(--color-text)]">{m.name}</span>
                      {m.size && (
                        <span className="text-[12px] text-[var(--color-text-muted)]">
                          {(m.size / 1e9).toFixed(1)} GB
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {modelsExpanded && ollamaModels.length === 0 && (
                <p className="mt-3 text-[13px] text-[var(--color-text-muted)]">
                  No models found. Run <code className="font-mono">ollama pull llama3.2</code> to get started.
                </p>
              )}
            </div>
          )}

          {!ollamaConnected && !ollamaLoading && (
            <div className="border-t border-[var(--color-border)] pt-5">
              <p className="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
                Ollama is not running. Start it with <code className="font-mono text-[var(--color-text)]">ollama serve</code> then refresh.
                AskMemo and embeddings won't work until connected.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* About Section */}
      <section>
        <h2 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-6">
          About
        </h2>
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-8 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[var(--color-brand)] flex items-center justify-center">
              <span className="text-white font-bold text-lg">O</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--color-text)]">OpenMemo</h3>
              <p className="text-[14px] text-[var(--color-text-secondary)] flex items-center gap-2">
                {versionLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>Version {version || '—'}</>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Open Source Credits */}
      <section className="mt-12">
        <h2 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-6">
          Built With
        </h2>
        <div className="bg-[var(--color-bg-card)] rounded-3xl p-8 shadow-sm">
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed mb-4">
            OpenMemo is made possible by these incredible open-source projects:
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { name: 'MDXEditor', url: 'https://mdxeditor.dev', desc: 'Inline markdown editing' },
              { name: 'Ollama', url: 'https://ollama.ai', desc: 'Local LLM inference' },
              { name: 'ChromaDB', url: 'https://chromadb.dev', desc: 'Vector database' },
              { name: 'TanStack Query', url: 'https://tanstack.com/query', desc: 'Data fetching' },
              { name: 'Zustand', url: 'https://github.com/pmndrs/zustand', desc: 'State management' },
              { name: 'dnd-kit', url: 'https://dndkit.com', desc: 'Drag & drop' },
            ].map((dep) => (
              <a
                key={dep.name}
                href={dep.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-brand)] hover:border-[var(--color-brand)]/30 transition-colors"
              >
                <span className="font-semibold">{dep.name}</span>
                <span className="text-[var(--color-text-muted)]">— {dep.desc}</span>
              </a>
            ))}
          </div>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-4">
            Thank you to every contributor who makes these tools available.
          </p>
        </div>
      </section>
    </div>
  );
}
