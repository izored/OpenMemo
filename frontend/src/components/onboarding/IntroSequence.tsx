/**
 * IntroSequence — the first-launch cinematic intro, CleanMyMac-style.
 *
 * A full-window, high-motion sequence: drifting accent orbs, a glass card, and
 * spring-staggered panels with an animated wordmark. It is the `intro` phase of
 * the onboarding flow (see components/Onboarding.tsx) and hands off to the
 * spotlight tour when the user takes it. Honors prefers-reduced-motion.
 *
 * Controlled: the parent decides when it's mounted and reacts to the callbacks.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Upload, Bot, Globe, X } from 'lucide-react';

interface Props {
  /** Final CTA — advance into the practical spotlight tour. */
  onTakeTour: () => void;
  /** Dismiss onboarding entirely. */
  onSkip: () => void;
}

interface Step {
  id: string;
  kicker?: string;
  title: string;
  body: string;
  Icon?: typeof Upload;
  /* Two accent positions the background orbs drift toward on this step. */
  orbs: [[string, string], [string, string]];
}

// Copy rules this had to be rewritten against: name the mess before the
// solution, short sentences, concrete nouns, never lead with privacy, and no
// platform claim. The old slide 1 said "everything you save lives on your Mac"
// in the SPA that Docker and Windows also serve, and three of four slides sold
// privacy before the product did anything.
const STEPS: Step[] = [
  {
    id: 'welcome',
    kicker: 'Welcome to',
    title: 'openMemo',
    body: 'You saved it somewhere. A tab, a DM to yourself, a screenshot you will never find again. openMemo is the somewhere. No cloud, no accounts.',
    orbs: [['18%', '24%'], ['78%', '70%']],
  },
  {
    id: 'capture',
    title: 'Throw it all in here',
    body: 'Links, notes, images, video, audio, whole playlists. Drop it in and openMemo pulls the title, the thumbnail and the text, then files it.',
    Icon: Upload,
    orbs: [['72%', '20%'], ['22%', '74%']],
  },
  {
    id: 'ask',
    title: 'Ask your own library',
    body: 'You will never remember which memo said it. Ask in plain words and a local model answers from your own stuff, showing the memos it used. It runs on your machine, so nothing leaves it.',
    Icon: Bot,
    orbs: [['26%', '70%'], ['76%', '26%']],
  },
  {
    id: 'ollama',
    title: 'Bring your own brain',
    body: 'That model is Ollama, and you install it yourself from ollama.com. openMemo only talks to it. Gemma 4 is a good place to start, and everything else here works without it.',
    Icon: Globe,
    orbs: [['50%', '18%'], ['50%', '82%']],
  },
];

const spring = { type: 'spring' as const, stiffness: 320, damping: 30 };

export function IntroSequence({ onTakeTour, onSkip }: Props) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);

  const last = i === STEPS.length - 1;

  // onTakeTour is the PARENT's setState, and calling it from inside a setI
  // updater ran it during the render phase, which React can replay. Keep the
  // side effect in the handler, but keep the functional updater too, so two
  // increments in one batch stay two.
  const next = useCallback(() => {
    if (i >= STEPS.length - 1) {
      onTakeTour();
      return;
    }
    setI((n) => Math.min(n + 1, STEPS.length - 1));
  }, [i, onTakeTour]);

  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A focused button turns Enter into a click as well, so handling it here
      // too advanced two slides for one keypress once the user had clicked Next
      // with the mouse. Let the button own Enter when the button has focus.
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.key === 'Escape') onSkip();
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, onSkip]);

  const step = STEPS[i];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in oklab, var(--accent) 6%, #08080a)',
        backdropFilter: 'blur(2px)',
        overflow: 'hidden',
        fontFamily: 'var(--font-ui)',
      }}
    >
      {/* Drifting accent orbs */}
      {step.orbs.map(([x, y], idx) => (
        <motion.div
          key={idx}
          aria-hidden
          animate={reduce ? {} : { left: x, top: y }}
          transition={{ type: 'spring', stiffness: 40, damping: 18 }}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: idx === 0 ? 520 : 420,
            height: idx === 0 ? 520 : 420,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background:
              idx === 0
                ? 'radial-gradient(circle, color-mix(in oklab, var(--accent) 55%, transparent) 0%, transparent 70%)'
                : 'radial-gradient(circle, color-mix(in oklab, var(--accent-deep) 50%, transparent) 0%, transparent 70%)',
            filter: 'blur(28px)',
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Skip */}
      <button
        onClick={onSkip}
        aria-label="Skip intro"
        style={{
          position: 'absolute',
          top: 22,
          right: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border-2)',
          background: 'color-mix(in oklab, var(--surface) 80%, transparent)',
          color: 'var(--text-3)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Skip <X size={13} />
      </button>

      {/* Glass card */}
      <motion.div
        initial={{ scale: reduce ? 1 : 0.94, opacity: 0, y: reduce ? 0 : 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={spring}
        style={{
          position: 'relative',
          width: 'min(560px, 92vw)',
          padding: '44px 44px 28px',
          borderRadius: 'var(--r-2xl)',
          border: '1px solid var(--border-2)',
          background: 'color-mix(in oklab, var(--surface) 86%, transparent)',
          backdropFilter: 'blur(18px)',
          boxShadow: 'var(--shadow-elev)',
          textAlign: 'center',
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: reduce ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -14 }}
            transition={{ ...spring, staggerChildren: 0.06, when: 'beforeChildren' }}
          >
            {step.Icon && (
              <motion.div
                initial={{ opacity: 0, scale: reduce ? 1 : 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={spring}
                style={{
                  width: 72,
                  height: 72,
                  margin: '0 auto 22px',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent-ink)',
                  border: '1px solid var(--border-2)',
                }}
              >
                <step.Icon size={32} strokeWidth={1.8} />
              </motion.div>
            )}

            {step.kicker && (
              <motion.p
                initial={{ opacity: 0, y: reduce ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                style={{ color: 'var(--text-3)', fontSize: 14, margin: '0 0 4px', letterSpacing: '0.04em' }}
              >
                {step.kicker}
              </motion.p>
            )}

            <motion.h1
              initial={{ opacity: 0, y: reduce ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              style={{
                margin: '0 0 14px',
                fontSize: step.id === 'welcome' ? 46 : 30,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.05,
                ...(step.id === 'welcome'
                  ? {
                      background:
                        'linear-gradient(100deg, var(--accent) 0%, var(--accent-deep) 55%, var(--accent) 100%)',
                      backgroundSize: '220% 100%',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                      animation: reduce ? undefined : 'om-shimmer 3.2s ease-in-out infinite',
                    }
                  : { color: 'var(--text)' }),
              }}
            >
              {step.title}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: reduce ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              style={{
                margin: '0 auto',
                maxWidth: 420,
                color: 'var(--text-2)',
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              {step.body}
            </motion.p>
          </motion.div>
        </AnimatePresence>

        {/* Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 34,
          }}
        >
          <button
            onClick={back}
            disabled={i === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border-2)',
              background: 'transparent',
              color: i === 0 ? 'var(--text-4)' : 'var(--text-2)',
              fontSize: 13,
              cursor: i === 0 ? 'default' : 'pointer',
            }}
          >
            <ArrowLeft size={15} /> Back
          </button>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 7 }}>
            {STEPS.map((s, idx) => (
              <span
                key={s.id}
                style={{
                  width: idx === i ? 22 : 7,
                  height: 7,
                  borderRadius: 99,
                  background: idx === i ? 'var(--accent)' : 'var(--border-2)',
                  transition: 'width 0.25s, background 0.25s',
                }}
              />
            ))}
          </div>

          <button
            onClick={next}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 18px',
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {last ? 'Take the tour' : 'Next'} <ArrowRight size={15} />
          </button>
        </div>
      </motion.div>

      {/* Scoped keyframe for the wordmark shimmer */}
      <style>{`@keyframes om-shimmer{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}`}</style>
    </motion.div>
  );
}
