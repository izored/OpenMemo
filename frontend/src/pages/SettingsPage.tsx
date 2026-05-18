import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { systemApi } from '@/lib/api';
import type { OllamaModel } from '@/types';

type Stats = {
  total_memos: number;
  total_collections: number;
  total_tags: number;
  memos_this_week: number;
  by_type: Record<string, number>;
};

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

  useEffect(() => {
    systemApi
      .health()
      .then((d) => {
        setVersion(d.version || '');
        setOllamaConnected(d.ollama_connected);
      })
      .catch(() => setOllamaConnected(false));
    systemApi.models().then((d) => setOllamaModels(d.models || [])).catch(() => setOllamaModels([]));
    systemApi.stats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="om-settings">
      <div className="om-settings-head">
        <span className="om-greet-eyebrow mono">Workspace · Personal</span>
        <h1 className="om-greet-title">Settings</h1>
        <p className="om-greet-sub">Tune the studio. Everything here is stored locally on your device.</p>
      </div>

      <div className="om-settings-grid">
        <SettingCard title="Appearance" eyebrow="Look & feel" wide>
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

        <SettingCard title="Profile" eyebrow="Identity">
          <div className="om-profile-row">
            <div className="om-avatar lg">RI</div>
            <div className="om-profile-info">
              <p className="om-profile-name">Reda Izo</p>
              <span className="mono om-profile-handle">@reda · izo.studio</span>
            </div>
            <a
              className="om-btn-secondary"
              style={{ marginLeft: 'auto' }}
              href="https://izo.red"
              target="_blank"
              rel="noopener noreferrer"
            >
              izo.red
            </a>
          </div>
        </SettingCard>

        <SettingCard title="Danger zone" eyebrow="Careful" wide>
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
                <p>Browser extension</p>
                <span className="mono">Clip from anywhere</span>
              </div>
              <a
                className="om-btn-secondary"
                href="https://github.com/izored/openmemo"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </div>
            <div className="om-setting-row">
              <div className="om-setting-row-text">
                <p>Feedback</p>
                <span className="mono">Bug or idea?</span>
              </div>
              <a className="om-btn-secondary" href="mailto:dev@izo.red?subject=[OpenMemo Feedback]">
                Email
              </a>
            </div>
          </div>
        </SettingCard>
      </div>

      <div
        className="mono"
        style={{ textAlign: 'center', padding: '32px 0 0', color: 'var(--text-4)', fontSize: 11 }}
      >
        OpenMemo · v{version || '—'}
      </div>
    </div>
  );
}
