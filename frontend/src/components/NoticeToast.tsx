import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

const DURATION = 4000;

// Branded notice toast — the in-app replacement for window.alert(). Same
// bottom-center geometry as the undo-delete toast so the two never feel like
// different systems. Auto-dismisses; the ✕ closes it early.
export function NoticeToast() {
  const notice = useAppStore((s) => s.notice);
  const clearNotice = useAppStore((s) => s.clearNotice);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!notice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new notice must not inherit the old exit state
    setClosing(false);
    const t = setTimeout(() => setClosing(true), DURATION);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className={cn('om-notice-toast', notice.kind, closing && 'closing')}
      role="alert"
      aria-live="assertive"
      onAnimationEnd={(e) => {
        if (closing && e.animationName === 'om-toast-out') {
          setClosing(false);
          clearNotice();
        }
      }}
    >
      <Icon name={notice.kind === 'error' ? 'alertTriangle' : 'info'} size={15} className="om-notice-toast-icon" />
      <span className="om-notice-toast-text">{notice.message}</span>
      <button className="om-notice-toast-close" onClick={() => setClosing(true)} title="Dismiss" aria-label="Dismiss">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
