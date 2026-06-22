import { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';

interface BottomBarProps {
  label?: string;
  children?: React.ReactNode;
  fab?: React.ReactNode;
  /** True while the fab is expanded into its modal — the bar shrinks just enough
   *  to clear the panel (the remaining filters scroll), it does not collapse. */
  fabExpanded?: boolean;
}

// Open island width (.om-island.open) + the row gap. The bar caps its width so
// its right edge stops before the panel that grows from the island (ADR-021).
const PANEL_W = 296;
const ROW_GAP = 8;

export function BottomBar({ label, children, fab, fabExpanded }: BottomBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const velRef = useRef(0);
  const shrunkRef = useRef(false); // latest `shrunk` for the rAF/scroll handlers
  const overflowRef = useRef(false); // latest `overflowing` for the scroll handler
  const [edgeL, setEdgeL] = useState(false);
  const [edgeR, setEdgeR] = useState(false);
  const setBottomBarPresent = useAppStore((s) => s.setBottomBarPresent);

  // Body class hides the Layout global FAB. The store flag tells the global
  // corner panels (AddMemoPanel / MusicAddModal) to step aside — the bottom bar
  // owns the New-Memo / Add-music flow through its IslandFab (ADR-021).
  useEffect(() => {
    document.body.classList.add('om-has-bbar');
    setBottomBarPresent(true);
    return () => {
      document.body.classList.remove('om-has-bbar');
      setBottomBarPresent(false);
    };
  }, [setBottomBarPresent]);

  // RAF auto-scroll — runs continuously, only moves when velRef !== 0.
  useEffect(() => {
    let id: number;
    const tick = () => {
      if (velRef.current && scrollRef.current) {
        scrollRef.current.scrollLeft += velRef.current;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    // No edge-scroll when the bar is covered or the content already fits (icons).
    if (!el || shrunkRef.current || !overflowRef.current) return;
    const { left, width } = el.getBoundingClientRect();
    const x = e.clientX - left;
    const zone = Math.min(52, width * 0.22);
    if (x < zone) {
      velRef.current = -Math.pow(1 - x / zone, 2) * 3.5;
      setEdgeL(true); setEdgeR(false);
    } else if (x > width - zone) {
      velRef.current = Math.pow((x - (width - zone)) / zone, 2) * 3.5;
      setEdgeR(true); setEdgeL(false);
    } else {
      velRef.current = 0; setEdgeL(false); setEdgeR(false);
    }
  }, []);

  const onLeave = useCallback(() => {
    velRef.current = 0; setEdgeL(false); setEdgeR(false);
  }, []);

  // While the fab is expanded into its modal, freeze the row to its expanded
  // width (filters pinned LEFT, fab pinned RIGHT) and cap the bar's width so it
  // contracts from the right only as far as the panel needs (ADR-021).
  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const shrunk = !!fabExpanded;
  shrunkRef.current = shrunk;

  // Measure the bar's NATURAL content width via scrollWidth. scrollWidth ignores
  // the animated maxWidth (overflow:hidden keeps it = full content), so the
  // open→close→open cycle can never feed a shrunken width back in and collapse
  // the bar. setState bails when unchanged, so the no-dep effect can't loop.
  const [barNaturalW, setBarNaturalW] = useState(0);
  // Whether the center slot actually overflows (text tabs). Icon-only filters fit,
  // so the edge-scroll hints/auto-scroll stay off for them (measured while expanded).
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const w = barRef.current?.scrollWidth ?? 0;
    if (w) setBarNaturalW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    const sc = scrollRef.current;
    if (sc && !shrunkRef.current) {
      const ov = sc.scrollWidth > sc.clientWidth + 2;
      setOverflowing((prev) => (prev === ov ? prev : ov));
    }
  });
  const showHints = overflowing && !shrunk;
  overflowRef.current = overflowing;

  const ISLAND_W = 50;
  const expandedRowW = barNaturalW ? barNaturalW + ROW_GAP + ISLAND_W : null;
  // Shrink to clear the panel ONLY if that still leaves a usable strip of filters
  // (> 120px ≈ 3 icons). Otherwise stay full and let the panel overlap — the bar
  // must NEVER collapse to a single icon.
  const shrinkTarget = barNaturalW - (PANEL_W - ISLAND_W);
  const barMaxWidth = shrunk && shrinkTarget > 120 ? shrinkTarget : undefined;

  return (
    <div className="om-bbar-area">
      {label && (
        <motion.p
          className="om-bbar-label"
          key={label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {label}
        </motion.p>
      )}

      <div
        ref={rowRef}
        className="om-bbar-row"
        style={expandedRowW ? { width: expandedRowW, justifyContent: 'space-between' } : undefined}
      >
        {/* The bar pill — only rendered when a page supplies center content.
            A fab-only page (e.g. Music) shows just the island. We animate the
            pill's OWN maxWidth (not FM `layout`) so only the pill resizes; its
            overflow:hidden cleanly covers the filters that no longer fit —
            `layout` would drag the active pill / icons around (ADR-021). */}
        {children && (
          <motion.div
            ref={barRef}
            className="om-bbar"
            animate={{ maxWidth: barMaxWidth ?? 1200 }}
            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
          >
            <div className="om-bbar-scroll-wrap">
              <AnimatePresence>
                {showHints && edgeL && (
                  <motion.div key="hl" className="om-bbar-hint om-bbar-hint--l"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }} aria-hidden="true">
                    <Icon name="chevronLeft" size={12} />
                  </motion.div>
                )}
              </AnimatePresence>

              <div
                ref={scrollRef}
                className={cn('om-bbar-scroll', shrunk && 'covered')}
                onMouseMove={onMouseMove}
                onMouseLeave={onLeave}
              >
                {children}
              </div>

              <AnimatePresence>
                {showHints && edgeR && (
                  <motion.div key="hr" className="om-bbar-hint om-bbar-hint--r"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }} aria-hidden="true">
                    <Icon name="chevronRight" size={12} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* RIGHT: FAB. Fixed 50×50 footprint (IslandFab owns its own morph), so no
            layout animation here — that would fight the island's growth. */}
        {fab}
      </div>
    </div>
  );
}
