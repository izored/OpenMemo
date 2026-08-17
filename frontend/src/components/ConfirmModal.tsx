/**
 * A branded stand-in for `window.confirm`.
 *
 * The destructive actions in Settings used the browser's own dialog. Inside the
 * Mac app that renders as a Chromium sheet in a frameless window: system font,
 * "localhost:8099 says", an OK button that does not look like anything else in
 * openMemo. It also blocks the whole renderer, which is a real cost on a page
 * that is polling relay status.
 *
 * The API is deliberately shaped like `confirm()` so the call sites read the
 * same: `if (!(await ask({...}))) return;`. Two-step confirmations pass
 * `secondary`, so "are you sure" and "no really" stay one component instead of
 * two nested awaits.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface ConfirmRequest {
  title: string;
  body: string;
  /** Shown after the first Confirm, as a second gate. Omit for a single step. */
  secondary?: string;
  confirmLabel?: string;
  /** Red confirm button, for anything that destroys data. */
  danger?: boolean;
}

interface Pending extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

export function useConfirm(): [(req: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const [onSecond, setOnSecond] = useState(false);

  const ask = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setOnSecond(false);
        setPending({ ...req, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
      setOnSecond(false);
    },
    [pending],
  );

  // Escape cancels, like the dialog it replaces. No Enter-to-confirm: these are
  // destructive, and a stray Enter should not wipe a library.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  const node = pending ? (
    <>
      <div className="om-backdrop" onClick={() => settle(false)} />
      <div className="om-modal" role="alertdialog" aria-label={pending.title} style={{ width: 'min(440px, calc(100vw - 32px))' }}>
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">
              {pending.secondary && onSecond ? 'Last chance' : 'Confirm'}
            </span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>{pending.title}</b>
          </div>
          <button className="om-icon-btn" onClick={() => settle(false)} aria-label="Cancel">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="om-modal-body">
          <p className="om-hint-readable" style={{ margin: 0 }}>
            {pending.secondary && onSecond ? pending.secondary : pending.body}
          </p>
        </div>
        <div className="om-modal-foot">
          <button className="om-btn-ghost" onClick={() => settle(false)}>Cancel</button>
          <button
            className={pending.danger ? 'om-btn-secondary danger' : 'om-btn-primary'}
            onClick={() => {
              if (pending.secondary && !onSecond) {
                setOnSecond(true);
                return;
              }
              settle(true);
            }}
          >
            {pending.secondary && !onSecond ? 'Continue' : pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </>
  ) : null;

  return [ask, node];
}
