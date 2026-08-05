import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Mesh walkthrough (ADR-024).
 *
 * Shown when the user switches Mesh on, and re-openable from the Settings card.
 * Mesh is the first feature that writes to the library on the user's behalf,
 * driven by a machine that is not in front of them — so it explains itself
 * before it ever does that, rather than after something looks wrong.
 *
 * The last step deliberately says pairing is not ready yet. A walkthrough that
 * implies a working sync would be worse than no walkthrough at all.
 */

interface Step {
  eyebrow: string;
  title: string;
  body: string;
  icon: string;
}

const STEPS: Step[] = [
  {
    eyebrow: 'What it is',
    title: 'One library, two computers',
    body: 'Your Mac and your PC each keep the whole library, and both can add, edit and delete. Changes travel in both directions, so it does not matter which machine you happen to be sitting at.',
    icon: 'refresh',
  },
  {
    eyebrow: 'No account',
    title: 'Nothing in the middle',
    body: 'No sign-up, no cloud, no server. You pair the two computers once with a 12-word code and they find each other on your network from then on. Your library never leaves your machines.',
    icon: 'link',
  },
  {
    eyebrow: 'How it stays fast',
    title: 'It sends the recipe, not the files',
    body: 'Most of your library is music and video that can be fetched again from where it came from, so the other computer downloads what you actually open instead of copying everything. Notes, tags, transcripts and AI summaries are small, so they arrive in seconds — and never get re-generated.',
    icon: 'sparkles',
  },
  {
    eyebrow: 'Your work is safe',
    title: 'Nothing is overwritten silently',
    body: 'If you edit the same memo on both computers, openMemo asks you which to keep and keeps both by default. Every change a sync makes is written down and can be undone.',
    icon: 'check',
  },
  {
    eyebrow: 'One more thing',
    title: 'Write the code down',
    body: 'The device that starts the Mesh mints a 12-word code and becomes the primary — it runs the Telegram bot and the heavy AI work. The other device joins with that code. openMemo keeps the words so you can read them again, next to the key they derive; if you would rather it did not, write them on paper and clear them from Settings.',
    icon: 'link',
  },
];

export function MeshIntroModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && !last) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, last, step]);

  const s = STEPS[step];

  return (
    <>
      <div className="om-backdrop" onClick={onClose} />
      <div
        ref={modalRef}
        className="om-modal"
        role="dialog"
        aria-label="About Mesh"
        aria-describedby="om-mesh-intro-body"
        style={{ width: 'min(520px, calc(100vw - 32px))' }}
      >
        <div className="om-modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono om-modal-eyebrow">{s.eyebrow}</span>
            <b style={{ fontSize: 16, fontWeight: 600 }}>Mesh</b>
          </div>
          <button className="om-icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="om-modal-body" style={{ gap: 14 }}>
          <div className="om-mesh-intro-art" aria-hidden>
            <Icon name={s.icon} size={22} />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{s.title}</h3>
          <p id="om-mesh-intro-body" className="om-hint-readable" style={{ margin: 0 }}>
            {s.body}
          </p>
        </div>

        <div className="om-mesh-intro-foot">
          <div className="om-mesh-intro-dots" role="tablist" aria-label="Walkthrough steps">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === step}
                aria-label={`Step ${i + 1} of ${STEPS.length}`}
                className={'om-mesh-intro-dot' + (i === step ? ' on' : '')}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="om-btn-secondary" onClick={() => setStep((v) => v - 1)}>
                Back
              </button>
            )}
            <button
              className="om-btn-primary"
              onClick={() => (last ? onClose() : setStep((v) => v + 1))}
            >
              {last ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
