import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

// A reusable, centered step-by-step guide popup — a product-tour feel in a
// modal card (not fullscreen). Steps are data; any step can render a live
// control (e.g. an upload widget) via `render`. Reuses the shared .om-modal /
// .om-backdrop design system so it themes automatically.
export interface GuideStep {
  id: string;
  title: string;
  body: ReactNode;
  /** Live content under the body (forms, uploads). Re-rendered each step view. */
  render?: () => ReactNode;
}

export function GuideModal({
  title,
  steps,
  onClose,
  finishLabel = 'Done',
}: {
  title: string;
  steps: GuideStep[];
  onClose: () => void;
  finishLabel?: string;
}) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const isLast = i === steps.length - 1;
  const isFirst = i === 0;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  if (!step) return null;

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div className="om-modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="mono om-modal-eyebrow">{title}</span>
            <b style={{ fontSize: 30, fontWeight: 650, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{step.title}</b>
          </div>
          <button className="om-icon-btn" onClick={onClose} aria-label="Close guide">
            <X size={14} />
          </button>
        </div>

        {/* Fixed min-height so the card doesn't resize as step content changes. */}
        <div className="om-modal-body" style={{ gap: 14, minHeight: 340, justifyContent: 'flex-start' }}>
          {/* Not .om-hint-readable — that class forces 12px !important. */}
          <div style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--text-2)', fontFamily: 'var(--font-ui)' }}>
            {step.body}
          </div>
          {step.render?.()}
        </div>

        <div className="om-modal-foot">
          <button className="om-btn-ghost" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={isFirst} style={isFirst ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
            <ArrowLeft size={14} /> Back
          </button>

          {/* Step dots */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} aria-hidden>
            {steps.map((s, n) => (
              <span
                key={s.id}
                style={{
                  width: n === i ? 18 : 7,
                  height: 7,
                  borderRadius: 99,
                  background: n === i ? 'var(--accent)' : 'var(--text-4)',
                  transition: 'width .2s ease, background .2s ease',
                }}
              />
            ))}
          </div>

          {isLast ? (
            <button className="om-btn-primary" onClick={onClose}>
              <span>{finishLabel}</span>
              <Check size={14} />
            </button>
          ) : (
            <button className="om-btn-primary" onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}>
              <span>Next</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
