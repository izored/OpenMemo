import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { ChangelogModal, cmpVersion } from '@/components/ChangelogModal';
import { useAppStore } from '@/stores/appStore';
import { systemApi } from '@/lib/api';
import type { OllamaModel } from '@/types';

const BUILT_WITH = [
  { name: 'React', url: 'https://react.dev' },
  { name: 'Vite', url: 'https://vitejs.dev' },
  { name: 'FastAPI', url: 'https://fastapi.tiangolo.com' },
  { name: 'SQLite', url: 'https://sqlite.org' },
  { name: 'Ollama', url: 'https://ollama.com' },
  { name: 'ChromaDB', url: 'https://www.trychroma.com' },
  { name: 'TanStack Query', url: 'https://tanstack.com/query' },
  { name: 'Zustand', url: 'https://github.com/pmndrs/zustand' },
  { name: 'framer-motion', url: 'https://motion.dev' },
  { name: 'dnd-kit', url: 'https://dndkit.com' },
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
  wide,
  children,
}: {
  title: string;
  eyebrow: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`om-setting-card ${wide ? 'wide' : ''}`}>
      <div className="om-setting-head">
        <span className="mono om-setting-eyebrow">{eyebrow}</span>
        <h3 className="om-setting-title">{title}</h3>
      </div>
      <div className="om-setting-body">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const t = useAppStore((s) => s.tweaks);
  const setAppearancePanelOpen = useAppStore((s) => s.setAppearancePanelOpen);
  const navigate = useNavigate();

  const openAppearance = () => {
    navigate('/');
    setTimeout(() => setAppearancePanelOpen(true), 280);
  };
  const [version, setVersion] = useState('');
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

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
    systemApi.stats().then(setStats).catch(() => setStats(null));
  }, []);

  // Always pulse in dev so the update flow is visible while building.
  const showUpdateDot = updateAvailable || import.meta.env.DEV;

  return (
    <div className="om-settings">
      <div className="om-settings-head">
        <span className="om-greet-eyebrow mono">Workspace · Personal</span>
        <h1 className="om-greet-title">Settings</h1>
        <p className="om-greet-sub">Tune the studio. Everything here is stored locally on your device.</p>
      </div>

      <div className="om-settings-grid">
        <SettingCard title="Appearance" eyebrow="Look & feel">
          <button className="om-appearance-cta" onClick={openAppearance}>
            <div className="om-appearance-cta-preview" aria-hidden>
              <span className="om-appearance-chip" style={{ background: t.accent }} />
              <span className="om-appearance-chip om-appearance-chip-2" />
              <span className="om-appearance-chip om-appearance-chip-3" />
            </div>
            <div className="om-appearance-cta-body">
              <div className="om-appearance-cta-head">
                <p>Open live preview</p>
                <span className="mono om-appearance-cta-meta">
                  {t.theme} · {t.cardStyle} · {t.layout} · {t.gridColumns} cols
                </span>
              </div>
              <span className="om-appearance-cta-sub">
                Tweak theme, accent, card style, density, columns, and background — changes apply instantly.
              </span>
            </div>
            <span className="om-appearance-cta-arrow">
              <Icon name="arrowUpRight" size={14} />
            </span>
          </button>
        </SettingCard>

        <SettingCard title="Browser extension" eyebrow="Capture">
          <a
            className="om-appearance-cta"
            href="https://github.com/izored/OpenMemo/tree/main/chrome-extension"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="om-appearance-cta-preview" aria-hidden>
              <span className="om-appearance-chip" style={{ background: 'var(--accent)' }} />
              <span className="om-appearance-chip om-appearance-chip-2" />
              <span className="om-appearance-chip om-appearance-chip-3" />
            </div>
            <div className="om-appearance-cta-body">
              <div className="om-appearance-cta-head">
                <p>Install the extension</p>
                <span className="mono om-appearance-cta-meta">Chromium · clip anywhere</span>
              </div>
              <span className="om-appearance-cta-sub">
                Load unpacked from <code>chrome-extension/</code> in the repo, or grab it from GitHub.
              </span>
            </div>
            <span className="om-appearance-cta-arrow">
              <Icon name="arrowUpRight" size={14} />
            </span>
          </a>
        </SettingCard>

        <SettingCard title="Your library" eyebrow="Stats">
          {stats ? (
            <>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Memos</p>
                  <span className="mono">total saved</span>
                </div>
                <span className="mono om-setting-val">{stats.total_memos.toLocaleString()}</span>
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Collections</p>
                </div>
                <span className="mono om-setting-val">{stats.total_collections}</span>
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Tags</p>
                </div>
                <span className="mono om-setting-val">{stats.total_tags}</span>
              </div>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>This week</p>
                </div>
                <span className="mono om-setting-val">{stats.memos_this_week}</span>
              </div>
            </>
          ) : (
            <p className="om-add-hint mono">Loading stats…</p>
          )}
        </SettingCard>

        <SettingCard title="Local AI" eyebrow="Ollama">
          <div className="om-setting-row">
            <div className="om-setting-row-text">
              <p>Connection</p>
              <span className="mono">Powers chat, RAG, embeddings</span>
            </div>
            <span className="mono om-setting-val" style={{ color: ollamaConnected ? 'var(--accent)' : '#EF5048' }}>
              {ollamaConnected === null ? '…' : ollamaConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div className="om-setting-row">
            <div className="om-setting-row-text">
              <p>Models</p>
              <span className="mono">{ollamaModels.map((m) => m.name).join(', ') || 'none'}</span>
            </div>
            <span className="mono om-setting-val">{ollamaModels.length}</span>
          </div>
        </SettingCard>

        <SettingCard title="Storage" eyebrow="Local-first">
          {stats?.storage ? (
            <>
              <div className="om-setting-row">
                <div className="om-setting-row-text">
                  <p>Total on disk</p>
                  <span className="mono">database · files · cache</span>
                </div>
                <span className="mono om-setting-val">{fmtBytes(stats.storage.total_bytes)}</span>
              </div>
              <div className="om-storage-bar" aria-hidden>
                <span
                  className="a"
                  style={{
                    width: `${(stats.storage.files_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%`,
                  }}
                />
                <span
                  className="b"
                  style={{
                    width: `${(stats.storage.cache_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%`,
                  }}
                />
              </div>
              <div className="om-storage-legend mono">
                <span><i className="a" /> Files · {fmtBytes(stats.storage.files_bytes)}</span>
                <span><i className="b" /> Cache · {fmtBytes(stats.storage.cache_bytes)}</span>
                <span>DB · {fmtBytes(stats.storage.db_bytes)}</span>
              </div>
            </>
          ) : (
            <p className="om-add-hint mono">Loading storage…</p>
          )}
        </SettingCard>

        <SettingCard title="Built with" eyebrow="Open source">
          <div className="om-creator-links" style={{ marginTop: 0 }}>
            {BUILT_WITH.map((d) => (
              <a
                key={d.name}
                className="om-creator-link"
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {d.name}
              </a>
            ))}
          </div>
        </SettingCard>

      </div>

      <div className="om-settings-bottom">
        <SettingCard title="Danger zone" eyebrow="Careful">
          <div className="om-danger-grid">
            <div className="om-setting-row">
              <div className="om-setting-row-text">
                <p>Export all memos</p>
                <span className="mono">JSON · Markdown bundle</span>
              </div>
              <a
                className="om-btn-secondary"
                href="/api/export/markdown"
                target="_blank"
                rel="noopener noreferrer"
              >
                Export
              </a>
            </div>
            <div className="om-setting-row">
              <div className="om-setting-row-text">
                <p>Delete cached previews</p>
                <span className="mono">
                  {stats?.storage ? `Frees ~${fmtBytes(stats.storage.cache_bytes)}` : 'Thumbnail cache'}
                </span>
              </div>
              <button className="om-btn-secondary" disabled title="Coming soon">
                Clear
              </button>
            </div>
            <div className="om-setting-row">
              <div className="om-setting-row-text">
                <p>Reset workspace</p>
                <span className="mono">Cannot be undone</span>
              </div>
              <button className="om-btn-secondary danger" disabled title="Coming soon">
                Reset
              </button>
            </div>
          </div>
        </SettingCard>

        <div className="om-setting-card om-creator-card">
          <div className="om-setting-head">
            <span className="mono om-setting-eyebrow">Made by</span>
          </div>
          <div className="om-setting-body">
            <p className="om-creator-name">Reda Izo</p>
            <span className="om-creator-role">Creative Director · OpenMemo</span>
            <p className="om-creator-bio">
              Building tools I want to use. OpenMemo is my second brain — links,
              notes, files, all local-first.
            </p>
            <div className="om-creator-links">
              <a className="om-creator-link" href="https://dev.izo.red" target="_blank" rel="noopener noreferrer">
                <Icon name="globe" size={12} /> dev.izo.red
              </a>
              <a
                className="om-creator-link"
                href="https://github.com/izored/OpenMemo"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="github" size={12} /> GitHub
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="om-settings-footer">
        <a
          className="om-creator-link"
          href="mailto:dev@izo.red?subject=[OpenMemo Feedback]&body=Hi Reda,%0A%0A"
        >
          <Icon name="message" size={12} /> Feedback
        </a>

        <button
          className="om-version-btn"
          onClick={() => setChangelogOpen(true)}
          title={showUpdateDot ? 'Update available' : 'Up to date'}
        >
          OpenMemo · v{version || '—'}
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
