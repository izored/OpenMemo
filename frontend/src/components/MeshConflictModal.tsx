import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { meshApi, type MeshChoice, type MeshConflict } from '@/lib/api';

/**
 * The conflict dialogue (ADR-024 §7).
 *
 * Modelled on the macOS/Windows "an item named X already exists" prompt, which
 * works because it names both items, shows what distinguishes them, offers a
 * keep-both escape hatch, and can be applied to the whole batch. None of that
 * is file-specific.
 *
 * Driven by a field diff rather than per-type UI, so a note, a playlist, a
 * Space cover and a voice memo all render through this one component.
 *
 * Two rules it exists to honour:
 *  - Keep both is preselected. The safe option is the default, always.
 *  - It shows the VALUES, not the field names. "the bass here is insane" tells
 *    you what you are choosing; `notes: modified` does not.
 */

const CHOICES: { value: MeshChoice; label: string; hint: string }[] = [
  { value: 'both', label: 'Keep both', hint: 'Nothing is lost. The other version is saved as a copy.' },
  { value: 'local', label: 'Keep mine', hint: 'This computer’s version wins.' },
  { value: 'remote', label: 'Keep theirs', hint: 'The other device’s version wins.' },
];

function Value({ text, muted }: { text: string | null; muted?: boolean }) {
  if (text === null || text === '') {
    return <span className="mono om-mesh-empty">empty</span>;
  }
  return (
    <span className="om-mesh-value" style={muted ? { color: 'var(--text-3)' } : undefined}>
      {text.length > 400 ? `${text.slice(0, 400)}…` : text}
    </span>
  );
}

export function MeshConflictModal({ onClose }: { onClose: () => void }) {
  const [conflicts, setConflicts] = useState<MeshConflict[]>([]);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<MeshChoice>('both');
  const [applyToAll, setApplyToAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    meshApi
      .conflicts()
      .then((r) => setConflicts(r.conflicts))
      .catch(() => setConflicts([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = conflicts[index];
  const remaining = conflicts.length - index - 1;

  const apply = async () => {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      await meshApi.resolve(current.id, choice, applyToAll);
      if (applyToAll || remaining === 0) {
        onClose();
        return;
      }
      setIndex((i) => i + 1);
      setChoice('both');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that choice');
    } finally {
      setBusy(false);
    }
  };

  if (!current) {
    return (
      <>
        <div className="om-backdrop" onClick={onClose} />
        <div className="om-modal" role="dialog" aria-label="Sync conflicts" style={{ width: 'min(460px, calc(100vw - 32px))' }}>
          <div className="om-modal-head">
            <span className="mono om-modal-eyebrow">Mesh</span>
            <button className="om-icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="om-modal-body">
            <p className="om-hint-readable" style={{ margin: 0 }}>
              Nothing needs your attention. Both computers agree.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div
        className="om-modal"
        role="dialog"
        aria-label="Sync conflicts"
        style={{ width: 'min(620px, calc(100vw - 32px))' }}
      >
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">
              Both devices changed this{conflicts.length > 1 ? ` · ${index + 1} of ${conflicts.length}` : ''}
            </span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>
              {current.field} on this {current.tbl.replace(/s$/, '')}
            </b>
          </div>
          <button className="om-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="om-modal-body" style={{ gap: 14 }}>
          {current.base_value !== null && (
            <div className="om-mesh-side">
              <span className="mono om-mesh-side-label">Before, on both</span>
              <Value text={current.base_value} muted />
            </div>
          )}
          <div className="om-mesh-side">
            <span className="mono om-mesh-side-label">This computer</span>
            <Value text={current.local_value} />
          </div>
          <div className="om-mesh-side">
            <span className="mono om-mesh-side-label">{current.peer}</span>
            <Value text={current.remote_value} />
          </div>

          <div className="om-mesh-choices" role="radiogroup" aria-label="What to keep">
            {CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={choice === c.value}
                className={'om-mesh-choice' + (choice === c.value ? ' on' : '')}
                onClick={() => setChoice(c.value)}
              >
                <b>{c.label}</b>
                <span className="mono">{c.hint}</span>
              </button>
            ))}
          </div>

          {remaining > 0 && (
            <label className="om-mesh-all">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
              />
              <span className="mono">
                Do the same for the other {remaining} {remaining === 1 ? 'conflict' : 'conflicts'}
              </span>
            </label>
          )}

          {error && (
            <p className="om-hint-readable" style={{ color: '#EF5048', margin: 0 }}>{error}</p>
          )}
        </div>

        <div className="om-mesh-intro-foot">
          <span className="mono" style={{ color: 'var(--text-4)' }}>
            Nothing has been changed yet
          </span>
          <button className="om-btn-primary" onClick={apply} disabled={busy}>
            {busy ? 'Saving…' : applyToAll ? `Apply to all ${conflicts.length}` : 'Apply'}
          </button>
        </div>
      </div>
    </>
  );
}
