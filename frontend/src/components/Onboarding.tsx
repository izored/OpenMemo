import { useEffect, useState, useLayoutEffect } from 'react';
import { Icon } from './Icon';
import { TOUR_STEPS, ONBOARDING_KEY } from '@/lib/onboarding';

type Phase = 'intro' | 'tour' | 'done';

function useAnchorRect(selector?: string, active?: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector || !active) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const id = setInterval(measure, 300); // cheap reflow follow
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [selector, active]);
  return rect;
}

export function Onboarding() {
  const [phase, setPhase] = useState<Phase>('done');
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) setPhase('intro');
  }, []);

  const finish = () => {
    localStorage.setItem(ONBOARDING_KEY, String(Date.now()));
    setPhase('done');
  };

  const current = TOUR_STEPS[step];
  const rect = useAnchorRect(current?.target, phase === 'tour');

  if (phase === 'done') return null;

  // ── Fullscreen first-impression intro ──────────────────────────────────
  // Placeholder stage. Drop a custom motion animation into `.om-intro-stage`
  // (CleanMyMac-style) — the layout, copy, and CTA stay.
  if (phase === 'intro') {
    return (
      <div className="om-intro">
        <div className="om-intro-stage">
          {/* ▼▼ ANIMATION SLOT — replace with a motion piece ▼▼ */}
          <div className="om-intro-orb" aria-hidden />
          {/* ▲▲ ANIMATION SLOT ▲▲ */}
        </div>
        <div className="om-intro-copy">
          <span className="mono om-greet-eyebrow">Welcome to</span>
          <h1 className="om-intro-title">OpenMemo</h1>
          <p className="om-intro-sub">Your second brain — links, notes, files, all local-first.</p>
          <div className="om-intro-actions">
            <button className="om-add-foot-btn primary" onClick={() => setPhase('tour')}>
              <span>Take the tour</span>
              <Icon name="arrowRight" size={13} />
            </button>
            <button className="om-add-foot-btn ghost" onClick={finish}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Coachmark tour ─────────────────────────────────────────────────────
  const last = step === TOUR_STEPS.length - 1;
  const place = current.placement || 'center';

  let cardStyle: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  };
  if (rect && place !== 'center') {
    const gap = 16;
    const pos: React.CSSProperties = { position: 'fixed', transform: 'none' };
    if (place === 'right') {
      pos.left = rect.right + gap;
      pos.top = Math.max(16, rect.top);
    } else if (place === 'left') {
      pos.right = window.innerWidth - rect.left + gap;
      pos.top = Math.max(16, rect.top - 40);
    } else if (place === 'top') {
      pos.left = rect.left;
      pos.bottom = window.innerHeight - rect.top + gap;
    } else {
      pos.left = rect.left;
      pos.top = rect.bottom + gap;
    }
    cardStyle = pos;
  }

  return (
    <div className="om-coach-layer">
      <div className="om-coach-backdrop" onClick={finish} />
      {rect && (
        <div
          className="om-coach-spot"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="om-coach-card" style={cardStyle}>
        <span className="mono om-greet-eyebrow">
          {step + 1} / {TOUR_STEPS.length}
        </span>
        <h3 className="om-coach-title">{current.title}</h3>
        <p className="om-coach-body">{current.body}</p>
        <div className="om-coach-actions">
          <button className="om-add-foot-btn ghost" onClick={finish}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {step > 0 && (
              <button className="om-add-foot-btn ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button
              className="om-add-foot-btn primary"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
            >
              <span>{last ? 'Done' : 'Next'}</span>
              {!last && <Icon name="arrowRight" size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
