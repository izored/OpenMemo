import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
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
export function IslandFab({ open, onOpenChange, icon = 'plus', label = 'New', hoverOpen, openWidth = 296, anchor = 'right', children }: IslandFabProps) {
  const rootRef = useRef<HTMLDivElement>(null);
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
        layout
        className={cn('om-island', open && 'open', anchor === 'center' && 'center')}
        style={{ ['--island-w' as string]: `${openWidth}px` }}
        transition={SPRING}
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
