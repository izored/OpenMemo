import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAudioPlayer } from '@/lib/audioPlayer';

// Volume level → number of waves on the speaker icon (max 3, the usual idiom).
//   muted / 0   → 0 waves (muted ✕)
//   (0, 0.33]   → 1 wave
//   (0.33,0.66] → 2 waves
//   (0.66, 1]   → 3 waves
function levelFor(volume: number, muted: boolean): number {
  if (muted || volume <= 0) return 0;
  if (volume <= 0.33) return 1;
  if (volume <= 0.66) return 2;
  return 3;
}

// Speaker with up to `active` wave arcs lit. active === 0 renders the muted ✕.
// Arcs fade individually so the 15s "attention pulse" (0→3→0→level) reads as a
// smooth ripple rather than a hard on/off.
function VolumeWaves({ active, size = 16 }: { active: number; size?: number }) {
  const muted = active <= 0;
  // Stroke-based (hollow) to match the repeat/transport icons — fill none,
  // stroke 2, round joins, currentColor (same as <Icon/>).
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      {muted ? (
        <path d="M22 9l-6 6M16 9l6 6" />
      ) : (
        <>
          <path d="M16 9a4 4 0 0 1 0 6" style={{ opacity: active >= 1 ? 1 : 0.18, transition: 'opacity .18s ease' }} />
          <path d="M18.5 7a8 8 0 0 1 0 10" style={{ opacity: active >= 2 ? 1 : 0.18, transition: 'opacity .18s ease' }} />
          <path d="M21 5a12 12 0 0 1 0 14" style={{ opacity: active >= 3 ? 1 : 0.18, transition: 'opacity .18s ease' }} />
        </>
      )}
    </svg>
  );
}

interface VolumeControlProps {
  /** The title (or anything) shown beside the icon at rest; hidden while the
   *  slider is open. Typically a <Marquee/> wrapped in a click-to-open-memo. */
  children?: React.ReactNode;
  className?: string;
  /** Icon size in px (full-bleed players use ~18, the small player ~14). */
  size?: number;
}

// Bottom-row volume control (ADR-010). Resting: animated speaker icon + the
// title. Click the icon → mute. Hover the control → a slider slides out over the
// title and lingers ~2s after the pointer leaves so it can be grabbed. Reads/
// writes the shared engine's volume so every surface stays in sync.
export function VolumeControl({ children, className, size = 18 }: VolumeControlProps) {
  const { volume, muted, setVolume, toggleMute } = useAudioPlayer();
  const rest = levelFor(volume, muted);
  const [waves, setWaves] = useState(rest);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const pulseTimers = useRef<number[]>([]);

  // Track the rest level (volume drag / mute changes the waves immediately).
  useEffect(() => {
    setWaves(rest);
  }, [rest]);

  // Attention pulse every 15s: sweep up 0→1→2→3 then back 3→2→1→0, then settle
  // on the current level. Skipped while muted (nothing to advertise).
  useEffect(() => {
    if (muted) return;
    const clearPulse = () => {
      pulseTimers.current.forEach((t) => window.clearTimeout(t));
      pulseTimers.current = [];
    };
    const id = window.setInterval(() => {
      clearPulse();
      const seq = [0, 1, 2, 3, 2, 1, 0, rest];
      pulseTimers.current = seq.map((w, i) => window.setTimeout(() => setWaves(w), i * 150));
    }, 15000);
    return () => {
      window.clearInterval(id);
      clearPulse();
    };
  }, [rest, muted]);

  // The slider opens on the ICON only (not the whole row) so hovering the title
  // still triggers its marquee; re-entering the control cancels the close timer
  // so moving icon→slider keeps it open, and leaving closes it after ~2s.
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };
  const openSlider = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 2000);
  };

  const pct = `${Math.round((muted ? 0 : volume) * 100)}%`;

  return (
    <div
      className={cn('om-vol', open && 'is-open', className)}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
      // Stop the drag from reaching the card's dnd-kit pointer sensor — without
      // this, grabbing the slider drags/reorders the card instead of seeking volume.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="om-vol-btn"
        onMouseEnter={openSlider}
        onFocus={openSlider}
        onClick={(e) => {
          e.stopPropagation();
          toggleMute();
        }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
      >
        <VolumeWaves active={muted ? 0 : waves} size={size} />
      </button>
      <input
        className="om-vol-slider"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        style={{ ['--vol-pct']: pct } as React.CSSProperties}
        onChange={(e) => {
          e.stopPropagation();
          setVolume(parseFloat(e.target.value));
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Volume"
        tabIndex={open ? 0 : -1}
      />
      {children != null && <span className="om-vol-title">{children}</span>}
    </div>
  );
}
