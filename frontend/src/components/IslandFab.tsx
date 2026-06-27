import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { useBeamConfig } from '@/lib/beamConfig';
import { cn } from '@/lib/utils';

interface IslandFabProps {
  /** Controlled open state (lives in the store, e.g. addPanelOpen). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Collapsed-state icon. Default 'plus'. */
  icon?: string;
  label?: string;
  /** Experiment (ADR-021): expand on hover, collapse on leave. No-op on touch. */
  hoverOpen?: boolean;
  /** Open width in px (must match the embedded content's width). Default 296.
   *  A FIXED width is required — Framer Motion's layout animation mis-measures
   *  `width:auto` and leaves the collapsed button stretched. */
  openWidth?: number;
  /** Grow direction. 'right' (default): anchored bottom-right, grows up-and-left
   *  (for a fab at the right end of the bar). 'center': grows symmetrically from
   *  the button's center (for a lone, centered fab like the Music page). */
  anchor?: 'right' | 'center';
  /** Drives the brighter "working" border-beam while a memo is being pulled
   *  in the background (OPNMMO-0051). Ambient beam shows regardless. */
  working?: boolean;
  /** Expanded content — the form the button grows into. */
  children: React.ReactNode;
}

const SPRING = { type: 'spring' as const, stiffness: 520, damping: 40 };

/**
 * The New Memo / Add-music button IS the modal, collapsed (ADR-021). One
 * `motion.div` pinned to the bottom-right of a fixed 50×50 footprint: collapsed
 * it is the rounded square, open it grows up and to the left into the full form
 * (Framer Motion `layout` animates the box). iOS Dynamic Island style.
 */
export function IslandFab({ open, onOpenChange, icon = 'plus', label = 'New', hoverOpen, openWidth = 296, anchor = 'right', working, children }: IslandFabProps) {
  const beam = useBeamConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false); // clicked open → don't auto-collapse on mouse leave
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on click-outside (primary dismiss) and Esc. The collection flyout
  // lives outside the island, so clicks inside it must not count as "outside".
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('.om-add-coll-flyout')) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  // Drive the hover-lighten easing from the beam config so it transitions
  // smoothly instead of snapping (tunable in the dev panel).
  useEffect(() => {
    document.documentElement.style.setProperty('--beam-hover-ms', `${beam.hoverTransitionMs}ms`);
  }, [beam.hoverTransitionMs]);

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  useEffect(() => { if (!open) pinnedRef.current = false; }, [open]);

  const clearHover = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const onEnter = () => {
    if (!hoverOpen || open) return;
    clearHover();
    hoverTimer.current = setTimeout(() => onOpenChange(true), 180);
  };
  const onLeave = () => {
    if (!hoverOpen || !open || pinnedRef.current) return;
    clearHover();
    hoverTimer.current = setTimeout(() => {
      // Keep open if the user is typing inside (focus within the island).
      if (rootRef.current?.contains(document.activeElement)) return;
      onOpenChange(false);
    }, 260);
  };

  return (
    <div
      ref={rootRef}
      className="om-island-root"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <motion.div
        ref={islandRef}
        layout
        className={cn('om-island', 'om-accent-beam', open && 'open', anchor === 'center' && 'center', working && 'working')}
        style={{
          ['--island-w' as string]: `${openWidth}px`,
          // Mono accent beam — opacity / speed / glow driven by the beam config.
          ['--om-beam-op' as string]: working ? beam.workingStrength : beam.ambientStrength,
          ['--om-beam-dur' as string]: `${working ? beam.workingDuration : beam.ambientDuration}s`,
          ['--om-beam-glow' as string]: `${Math.round((working ? beam.workingBrightness : beam.ambientBrightness) * 8)}px`,
          // Scale origin matches the CSS anchor so FM never extends the island
          // past its anchored edge during the open/close layout animation.
          // Right-anchored (default): grow left+up from bottom-right corner.
          // Center-anchored (Music): grow symmetrically from bottom-center.
          originX: anchor === 'center' ? 0.5 : 1,
          originY: 1,
        }}
        transition={SPRING}
        onLayoutAnimationStart={() => islandRef.current?.classList.add('om-island--clipping')}
        onLayoutAnimationComplete={() => islandRef.current?.classList.remove('om-island--clipping')}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {open ? (
            // Form fades out FAST on close so it never ghosts behind the +.
            <motion.div
              key="body"
              className="om-island-body"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.12, delay: open ? 0.08 : 0 } }}
            >
              {children}
            </motion.div>
          ) : (
            // + fades in only AFTER the box has mostly collapsed, so you never
            // see a large + sitting in a still-wide box (ADR-021).
            <motion.button
              key="trigger"
              type="button"
              className="om-island-trigger"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ opacity: { duration: 0.1, delay: 0.16 } }}
              onClick={() => { pinnedRef.current = true; onOpenChange(true); }}
              aria-label={label}
              title={`${label} · N`}
            >
              <Icon name={icon} size={20} />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
