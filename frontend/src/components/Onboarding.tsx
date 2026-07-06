import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icon';
import { TOUR_STEPS, ONBOARDING_KEY } from '@/lib/onboarding';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { IntroSequence } from './onboarding/IntroSequence';

type Phase = 'intro' | 'tour' | 'done';

function useAnchorRect(selector?: string, active?: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector || !active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the measured rect when the anchor is inactive
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
  const addPanelOpen = useAppStore((s) => s.addPanelOpen);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the intro once on first mount
    if (!localStorage.getItem(ONBOARDING_KEY)) setPhase('intro');
    const retake = () => {
      // Replay the whole onboarding: cinematic intro first, then the spotlight
      // tour (Settings → "Replay product tour" fires this).
      setStep(0);
      setPhase('intro');
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

  // Close the add panel when the tour starts so the FAB is visible
  useEffect(() => {
    if (phase === 'tour') setAddPanelOpen(false);
  }, [phase, setAddPanelOpen]);
  // When step changes, re-hide the panel so gated steps start at the FAB.
  useEffect(() => {
    if (phase === 'tour' && current?.gate === 'panelOpen') setAddPanelOpen(false);
  }, [step, phase, current?.gate, setAddPanelOpen]);

  // Gate logic: the `add` step waits for the user to click the FAB and open
  // the panel before Next becomes available. Once open, the spot morphs to
  // the new-memo panel via `morphTarget`.
  const gateSatisfied = current?.gate === 'panelOpen' ? addPanelOpen : true;
  const effectiveTarget = current?.gate === 'panelOpen' && addPanelOpen
    ? current.morphTarget ?? current.target
    : current?.target;
  const effectiveBody = current?.gate === 'panelOpen' && addPanelOpen
    ? current.gateBody ?? current.body
    : current?.body;
  const rect = useAnchorRect(effectiveTarget, phase === 'tour');
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

  // ── Fullscreen first-impression intro (CleanMyMac-style) ───────────────
  // The cinematic, high-motion sequence. On "Take the tour" it hands off to the
  // spotlight coachmarks below; Skip dismisses onboarding entirely.
  if (phase === 'intro') {
    return <IntroSequence onTakeTour={() => setPhase('tour')} onSkip={finish} />;
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
    <div className={cn('om-coach-layer', current?.gate === 'panelOpen' && !addPanelOpen && 'gated')}>
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
        <p className="om-coach-body">{effectiveBody}</p>
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
              disabled={!gateSatisfied}
              title={gateSatisfied ? '' : 'Click the + button first'}
              onClick={() => {
                if (!gateSatisfied) return;
                if (last) return finish();
                setStep((s) => s + 1);
              }}
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
