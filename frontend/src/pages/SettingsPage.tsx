import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Icon } from '@/components/Icon';
import { ChangelogModal, cmpVersion } from '@/components/ChangelogModal';
import { ONBOARDING_KEY } from '@/lib/onboarding';
import { useAppStore } from '@/stores/appStore';
import { systemApi, maintenanceApi, backupApi, settingsApi } from '@/lib/api';
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
  const [backing, setBacking] = useState<'structure' | 'full' | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null);
  const [maxUploadSaved, setMaxUploadSaved] = useState(false);
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
    systemApi.stats().then(setStats).catch(() => setStats(null));
    settingsApi.get().then((s) => setMaxUploadMb(s.max_upload_mb)).catch(() => setMaxUploadMb(5120));
  }, []);

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

  const handleBackup = async (scope: 'structure' | 'full') => {
    setBacking(scope);
    try {
      await backupApi.download(scope);
    } catch (err: any) {
      alert(`Backup failed: ${err.message}`);
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
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  // Always pulse in dev so the update flow is visible while building.
  const showUpdateDot = updateAvailable || import.meta.env.DEV;

  return (
    <div className="om-settings">
      <div className="om-settings-head">
        <span className="om-greet-eyebrow mono">Workspace · Personal</span>
        <h1 className="om-greet-title">Settings</h1>
        <p className="om-greet-sub">Everything here is stored on your machine. No cloud, no account.</p>
      </div>

      <div className="om-settings-grid">

        {/* ── Left column ─────────────────────────────────────── */}
        <div className="om-settings-col">
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
                  Tweak theme, accent, card style, layout, columns and background. Changes apply instantly.
                </span>
              </div>
              <span className="om-appearance-cta-arrow">
                <Icon name="arrowUpRight" size={14} />
              </span>
            </button>
            <div className="om-setting-row" style={{ borderTop: '1px solid var(--border)', marginTop: 8 }}>
              <div className="om-setting-row-text">
                <p>Product tour</p>
                <span className="mono">Replay the welcome walkthrough</span>
              </div>
              <button
                className="om-btn-secondary"
                onClick={() => {
                  localStorage.removeItem(ONBOARDING_KEY);
                  window.dispatchEvent(new Event('openmemo:retake-tour'));
                }}
              >
                Retake
              </button>
            </div>
          </SettingCard>

          <SettingCard title="Library & Storage" eyebrow="Stats">
            <div className="om-library-storage-grid">
              <div className="om-library-col">
                {stats ? (
                  <div className="om-stats-2x2">
                    {[
                      { label: 'Memos', sub: 'total saved', val: stats.total_memos.toLocaleString() },
                      { label: 'Collections', sub: '', val: stats.total_collections },
                      { label: 'Tags', sub: '', val: stats.total_tags },
                      { label: 'This week', sub: '', val: stats.memos_this_week },
                    ].map((s) => (
                      <div key={s.label} className="om-stat-cell">
                        <span className="mono om-setting-val">{s.val}</span>
                        <p>{s.label}</p>
                        {s.sub && <span className="mono">{s.sub}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="om-add-hint mono">Loading stats…</p>
                )}
              </div>
              <div className="om-storage-col">
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
                      <span className="a" style={{ width: `${(stats.storage.files_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%` }} />
                      <span className="b" style={{ width: `${(stats.storage.cache_bytes / Math.max(1, stats.storage.total_bytes)) * 100}%` }} />
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
              </div>
            </div>
          </SettingCard>

          <SettingCard title="Uploads" eyebrow="Limits">
            <div className="om-setting-row">
              <div className="om-setting-row-text">
                <p>Max upload size</p>
                <span className="mono">Per file. Any file type is accepted. Default 5120 MB (5 GB).</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={51200}
                  value={maxUploadMb ?? ''}
                  onChange={(e) => setMaxUploadMb(e.target.value === '' ? null : Number(e.target.value))}
                  className="om-input"
                  style={{ width: 110, textAlign: 'right' }}
                />
                <span className="mono om-setting-val">MB</span>
                <button className="om-btn-secondary" onClick={saveMaxUpload} disabled={maxUploadMb == null}>
                  {maxUploadSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          </SettingCard>

          <SettingCard title="Backup & Restore" eyebrow="Data safety">
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
                      systemApi.stats().then(setStats).catch(() => {});
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
        </div>

        {/* ── Right column ────────────────────────────────────── */}
        <div className="om-settings-col">
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

          <SettingCard title="Built with" eyebrow="Open source">
            <div className="om-creator-links" style={{ marginTop: 0 }}>
              {BUILT_WITH.map((d) => (
                <a key={d.name} className="om-creator-link" href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.name}
                </a>
              ))}
            </div>
          </SettingCard>

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
        </div>

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
