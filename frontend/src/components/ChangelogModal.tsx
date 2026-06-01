import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from './Icon';

const REPO = 'izored/OpenMemo';

interface Release {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function ChangelogModal({
  current,
  onClose,
}: {
  current: string;
  onClose: () => void;
}) {
  const [rel, setRel] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop);
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const load = () => {
    setLoading(true);
    setError('');
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub ${r.status}`))))
      .then((d: Release) => setRel(d))
      .catch((e) => setError(e.message || 'Could not reach GitHub'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const latest = rel?.tag_name?.replace(/^v/, '') || '';
  const updateAvailable = !!latest && cmpVersion(latest, current) > 0;

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div ref={modalRef} className="om-modal" role="dialog" aria-label="Changelog" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">What's new</span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>{rel?.name || rel?.tag_name || 'Latest release'}</b>
          </div>
          <button className="om-icon-btn" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div
          className="om-modal-body"
          style={{ gap: 12 }}
        >
          {loading && <p className="om-hint-readable">Checking GitHub…</p>}
          {error && <p className="om-hint-readable" style={{ color: '#EF5048' }}>{error}</p>}

          {rel && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: updateAvailable ? 'var(--accent-soft)' : 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: updateAvailable ? '#2F7DF6' : 'var(--text-4)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13 }}>
                  {updateAvailable
                    ? `Update available: v${latest} (you're on v${current})`
                    : `You're up to date on v${current}`}
                </span>
              </div>

              <div className="om-detail-summary" style={{ background: 'transparent', border: 0, padding: 0, fontSize: 13.5 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {rel.body || '_No release notes._'}
                </ReactMarkdown>
              </div>

              {updateAvailable && (
                <div
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span className="mono om-modal-eyebrow">How to update</span>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                    <li><code>git pull</code></li>
                    <li><code>docker compose up -d --build</code> (or rerun the dev servers)</li>
                  </ol>
                </div>
              )}
            </>
          )}
        </div>

        <div className="om-modal-foot">
          <button className="om-btn-ghost" onClick={load} disabled={loading}>
            <Icon name="refresh" size={13} />
            Check again
          </button>
          {rel && (
            <a className="om-btn-primary" href={rel.html_url} target="_blank" rel="noopener noreferrer">
              <span>Open on GitHub</span>
              <Icon name="arrowUpRight" size={12} />
            </a>
          )}
        </div>
      </div>
    </>
  );
}
