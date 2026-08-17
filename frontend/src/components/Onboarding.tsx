import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { Icon } from './Icon';
import { TOUR_STEPS, ONBOARDING_KEY, type TourStep } from '@/lib/onboarding';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import { modKeys, useInstall } from '@/lib/install';
import { IntroSequence } from './onboarding/IntroSequence';

type Phase = 'intro' | 'tour' | 'done';

/**
 * Is this anchor something we can actually point at right now?
 *
 * A missing selector is the obvious case, but the damaging one is an element
 * that exists and lays out somewhere the user cannot see. Below 1024px the
 * sidebar becomes an off-canvas drawer (`translateX(-100%)`), so every sidebar
 * anchor still measures fine and sits a whole viewport to the left. The old
 * code happily placed the card at `rect.right + gap`, which clamps to the
 * top-left corner, and drew the spotlight off screen: a tour pointing at
 * nothing, over an app the layer had locked.
 */
function rectIsVisible(r: DOMRect): boolean {
  if (r.width <= 0 || r.height <= 0) return false; // display:none measures as zero
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
}

/**
 * The first candidate in `selector` that is actually on screen, or null.
 *
 * `querySelector` returns the first match in DOM order, which is the wrong one
 * when a page ships two versions of the same control and hides one. Walking the
 * matches and taking the first visible one is what lets a step name both.
 */
function visibleAnchor(selector?: string): Element | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll(selector)) {
    if (rectIsVisible(el.getBoundingClientRect())) return el;
  }
  return null;
}

function anchorUsable(selector?: string): boolean {
  if (!selector) return true; // centered step, nothing to point at by design
  return !!visibleAnchor(selector);
}

function useAnchorRect(selector?: string, active?: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector || !active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the measured rect when the anchor is inactive
      setRect(null);
      return;
    }
    let scrolled = false;
    const measure = () => {
      const el = visibleAnchor(selector);
      if (el && !scrolled) {
        // Sidebar sections live in their own scroll region, so Collections can
        // sit below the fold on a short window. Bring it up once per step,
        // before the first measure lands, rather than spotlighting off screen.
        scrolled = true;
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      // Null, not a zero or off-screen rect. The card then falls back to the
      // centered layout with a plain dim, instead of drawing a 12px spotlight
      // in the corner over an app the layer has locked. This is what keeps a
      // mid-tour resize or sidebar collapse from reproducing the original bug.
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
  // The steps this window can actually show, decided once when the tour opens.
  const [steps, setSteps] = useState<TourStep[]>(TOUR_STEPS);
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);
  const addPanelOpen = useAppStore((s) => s.addPanelOpen);
  const { isMac } = useInstall();

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

  const current = steps[step];

  // Close the add panel when the tour starts so the FAB is visible, and drop
  // any step whose anchor is hidden in this window (collapsed sidebar, drawer
  // layout). Showing four honest steps beats eight pointing at nothing.
  useEffect(() => {
    if (phase !== 'tour') return;
    setAddPanelOpen(false);
    const usable = TOUR_STEPS.filter((s) => anchorUsable(s.target));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the anchor set can only be measured once the tour is on screen
    setSteps(usable);
    if (usable.length === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable enough here; re-running on every render would re-filter mid-tour
  }, [phase, setAddPanelOpen]);

  // When step changes, re-hide the panel so gated steps start at the FAB.
  useEffect(() => {
    if (phase === 'tour' && current?.gate === 'panelOpen') setAddPanelOpen(false);
  }, [step, phase, current?.gate, setAddPanelOpen]);

  // Gate logic: the `add` step waits for the user to click the FAB and open
  // the panel before Next becomes available. Once open, the spot morphs to
  // the new-memo panel via `morphTarget`.
  // Gated on the panel opening, unless the thing to click is not on screen any
  // more. The user can move around during a gated step (that is the point of
  // letting clicks through), and Ask Memo has no + at all while Music's + opens
  // a different panel: without this, wandering there left Next disabled with no
  // way forward but Skip.
  const gateAnchorGone = current?.gate === 'panelOpen' && !visibleAnchor(current.target);
  const gateSatisfied = current?.gate === 'panelOpen' ? addPanelOpen || gateAnchorGone : true;
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

  if (!current) return null; // filtered to nothing; finish() already ran

  // ── Coachmark tour ─────────────────────────────────────────────────────
  const last = step === steps.length - 1;
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
  // Keep out of the macOS traffic lights. The window is frameless
  // (`titleBarStyle: 'hiddenInset'`), so the close/minimise/zoom buttons float
  // over the web content in the top-left and swallow every click under them.
  // A card clamped to the corner puts its own header there, and on the Mac the
  // sidebar header is also a window-drag region, which eats clicks the same way.
  const TRAFFIC_LIGHTS = { w: 120, h: 40 };
  if (isMac && x < TRAFFIC_LIGHTS.w && y < TRAFFIC_LIGHTS.h) y = TRAFFIC_LIGHTS.h + 4;
  const cardStyle: React.CSSProperties = { position: 'fixed', left: x, top: y, transform: 'none' };

  return (
    // Gated steps stay click-through for their whole life, not just until the
    // panel opens. The layer used to re-arm the moment the gate was satisfied,
    // so the tour said "save a link, hit Next when ready" over a New Memo panel
    // that could not be typed into. Non-gated steps still lock the app.
    <div className={cn('om-coach-layer', current?.gate === 'panelOpen' && 'gated')}>
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
          {step + 1} / {steps.length}
        </span>
        <h3 className="om-coach-title">{current.title}</h3>
        <p className="om-coach-body">{modKeys(effectiveBody ?? '')}</p>
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
