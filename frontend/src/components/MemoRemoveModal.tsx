/**
 * "Remove this memo" — the branded confirm behind the trash icon on a memo page.
 *
 * It replaces an inline popover that hung off the header icon. Two problems with
 * that: it read as a tooltip rather than a destructive gate, and it offered one
 * outcome when the card grid has offered two since OPNMMO-0016. Hide and Delete
 * are different intentions and both belong here, spelled out, so the choice is
 * made on what happens to the memo rather than on which pill is red.
 *
 * Portaled to <body> on purpose. The detail pane animates a transform on entry
 * and its scroll container declares `container-type: inline-size`, either of
 * which turns an ancestor into the containing block for `position: fixed` and
 * would trap the modal inside the column.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Loader2, Trash2, X } from 'lucide-react';
import type { Memo } from '@/types';

interface Props {
  memo: Memo;
  busy: 'hide' | 'delete' | null;
  onHide: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function MemoRemoveModal({ memo, busy, onHide, onDelete, onCancel }: Props) {
  // Escape cancels. No Enter-to-confirm: one of these two buttons destroys
  // something, and a stray Enter should never be the thing that fires it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const hiding = busy === 'hide';
  const deleting = busy === 'delete';

  return createPortal(
    <>
      <div className="om-backdrop" onClick={() => !busy && onCancel()} />
      <div
        className="om-modal om-remove-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={`Remove ${memo.title}`}
      >
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="mono om-modal-eyebrow">Remove memo</span>
            <b className="om-remove-title">{memo.title || 'Untitled memo'}</b>
          </div>
          <button className="om-icon-btn" onClick={onCancel} disabled={!!busy} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>

        <div className="om-modal-body">
          <button className="om-remove-choice" onClick={onHide} disabled={!!busy}>
            <span className="om-remove-choice-icon">
              {hiding ? <Loader2 size={16} className="om-spin" /> : memo.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
            </span>
            <span className="om-remove-choice-text">
              <b>{memo.hidden ? 'Unhide it' : 'Hide it'}</b>
              <span>
                {memo.hidden
                  ? 'Puts it back on the dashboard. Nothing else changes.'
                  : 'Off the dashboard, still in its collections. It lives in the Hidden section.'}
              </span>
            </span>
          </button>

          <button className="om-remove-choice danger" onClick={onDelete} disabled={!!busy}>
            <span className="om-remove-choice-icon">
              {deleting ? <Loader2 size={16} className="om-spin" /> : <Trash2 size={16} />}
            </span>
            <span className="om-remove-choice-text">
              <b>Delete it</b>
              <span>Undo for a few seconds, then restore it from Settings. Files stay on disk.</span>
            </span>
          </button>
        </div>

        <div className="om-modal-foot">
          <span className="om-hint-readable" style={{ margin: 0 }}>Escape to cancel</span>
          <button className="om-btn-ghost" onClick={onCancel} disabled={!!busy}>Cancel</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
