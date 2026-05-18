import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icon';
import { TOUR_STEPS, ONBOARDING_KEY } from '@/lib/onboarding';
import { useAppStore } from '@/stores/appStore';

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
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);

  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) setPhase('intro');
    const retake = () => {
      setStep(0);
      setPhase('tour');
    };
    window.addEventListener('openmemo:retake-tour', retake);
    return () => window.removeEventListener('openmemo:retake-tour', retake);
  }, []);

  const finish = () => {
    localStorage.setItem(ONBOARDING_KEY, String(Date.now()));
    setAddPanelOpen(false);
    setPhase('done');
  };

  const current = TOUR_STEPS[step];

  // Run a step's side-effect (e.g. open the add panel so the spotlight can
  // animate to it). Keep the panel open only while that step is active.
  useEffect(() => {
    if (phase !== 'tour') return;
    setAddPanelOpen(current?.action === 'openAdd');
  }, [phase, step, current?.action, setAddPanelOpen]);
  const rect = useAnchorRect(current?.target, phase === 'tour');
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 320, h: 210 });

  useLayoutEffect(() => {
    if (phase !== 'tour') return;
    const el = cardRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.width !== cardSize.w || r.height !== cardSize.h)) {
        setCardSize({ w: r.width, h: r.height });
      }
    }
  }, [phase, step, rect, cardSize.w, cardSize.h]);

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
          <h1 className="om-intro-title">openMemo</h1>
          <p className="om-intro-sub">One place for everything worth saving. On your machine. Free.</p>
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

  const gap = 16;
  const M = 16; // viewport margin
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { w: cw, h: ch } = cardSize;

  let x: number;
  let y: number;
  if (!rect || place === 'center') {
    x = (vw - cw) / 2;
    y = (vh - ch) / 2;
  } else if (place === 'right') {
    x = rect.right + gap;
    y = rect.top;
  } else if (place === 'left') {
    x = rect.left - cw - gap;
    y = rect.top;
  } else if (place === 'top') {
    x = rect.left;
    y = rect.top - ch - gap;
  } else {
    x = rect.left;
    y = rect.bottom + gap;
  }
  // Clamp fully inside the viewport so edge anchors (FAB, sidebar foot) never clip.
  x = Math.min(Math.max(M, x), Math.max(M, vw - cw - M));
  y = Math.min(Math.max(M, y), Math.max(M, vh - ch - M));
  const cardStyle: React.CSSProperties = { position: 'fixed', left: x, top: y, transform: 'none' };

  return (
    <div className="om-coach-layer">
      {!rect && <div className="om-coach-dim" />}
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
      <div ref={cardRef} className="om-coach-card" style={cardStyle}>
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
