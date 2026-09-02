import {
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { MemoCard } from './MemoCard';
import { Icon } from './Icon';
import { collectionApi, memoApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Memo } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { useDndBus } from '@/lib/dndBus';
import { useIsMobile } from '@/lib/useBreakpoint';

interface MemoGridProps {
  memos: Memo[];
  /** Changes when the active filter/collection changes → the grid crossfades to
   *  the new set as one layer (O(1), scales to thousands of memos). */
  transitionKey?: string;
}

function SortableMemoCard({ memo, anyDragActive, lightboxGroup, transitionKey, dragDisabled }: { memo: Memo; anyDragActive: boolean; lightboxGroup: Memo[]; transitionKey?: string; dragDisabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: memo.id, disabled: dragDisabled });
  return (
    <motion.div
      ref={setNodeRef}
      layout={!anyDragActive}
      // Namespace the layoutId per filter set so cards don't fly between two
      // different filters' grids (shared-element match). Within a set it stays
      // stable, so drag-to-reorder still animates.
      layoutId={transitionKey ? `${transitionKey}:${memo.id}` : memo.id}
      transition={{ layout: { duration: 0.25, ease: [0.25, 1, 0.5, 1] } }}
      style={{ opacity: isDragging ? 0 : 1 }}
    >
      <MemoCard memo={memo} dragHandleProps={{ attributes, listeners: listeners || {} }} lightboxGroup={lightboxGroup} />
    </motion.div>
  );
}

function useViewportColumns(userCols: number): number {
  const [cap, setCap] = useState(5);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      if (w <= 640) setCap(1);          // phone: a single readable column
      else if (w < 900) setCap(2);
      else if (w < 1280) setCap(3);
      else if (w < 1500) setCap(4);
      else setCap(5);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return Math.min(userCols, cap);
}

// CSS-grid masonry cell (replaces react-masonry-css — column buckets can't host
// a card spanning two columns). The grid runs on tiny 2px auto-rows; each cell
// measures its content and spans ceil((height + gap) / 2) rows, so cards pack
// like a masonry while `grid-column: span 2` gives user-resized wide cards a
// true two-column footprint (grid-auto-flow: dense backfills beside them).
const ROW_UNIT = 2;

function MasonryCell({
  wide,
  gap,
  children,
}: {
  wide: boolean;
  gap: number;
  children: React.ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(1);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      setRows(Math.max(1, Math.ceil((h + gap) / ROW_UNIT)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gap]);
  return (
    <div
      className="om-masonry-cell"
      style={{ gridRowEnd: `span ${rows}`, gridColumn: wide ? 'span 2' : undefined }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

/** Droppable ids that belong to the sidebar rather than to the grid.
 *
 *  The reorder preview keys off "am I hovering another card", so every sidebar
 *  target has to be excluded by name. Missing one means dragging a memo towards
 *  a Space silently reshuffles the dashboard behind it. */
function isSidebarTarget(id: string): boolean {
  return id.startsWith('col-') || id.startsWith('space-') || id.startsWith('spacecol-');
}

export function MemoGrid({ memos: serverMemos, transitionKey }: MemoGridProps) {
  const queryClient = useQueryClient();
  const tweaks = useAppStore((s) => s.tweaks);
  const columns = useViewportColumns(tweaks.gridColumns || 4);
  // Gutter between tiles is user-controlled (Appearance slider), applied to
  // every card style — Edge included, so the wall can be gapless (0) or spaced.
  const gap = tweaks.gutter ?? 20;

  const dndBus = useDndBus();
  // Drag-to-reorder is a desktop affordance. On tablet/phone it fights native
  // scroll, so disable it below the desktop breakpoint (ADR-009).
  const dragDisabled = useIsMobile();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localMemos, setLocalMemos] = useState(serverMemos);
  const reorderingRef = useRef(false);
  const dragOrderRef = useRef<Memo[]>([]);
  const lastOverIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId && !reorderingRef.current) setLocalMemos(serverMemos);
  }, [serverMemos, activeId]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    lastOverIdRef.current = null;
    dragOrderRef.current = [...localMemos];
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const overId = String(over.id);
    // Every sidebar drop target, not just library collections. Hovering a Space
    // row while dragging must not start reshuffling the grid underneath.
    if (isSidebarTarget(overId)) return;
    if (overId === lastOverIdRef.current) return;
    lastOverIdRef.current = overId;
    const oldIndex = dragOrderRef.current.findIndex((m) => m.id === active.id);
    const newIndex = dragOrderRef.current.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    dragOrderRef.current = arrayMove(dragOrderRef.current, oldIndex, newIndex);
    setLocalMemos([...dragOrderRef.current]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    lastOverIdRef.current = null;

    const overId = over ? String(over.id) : '';

    // A library collection: a membership, so the memo stays where it is.
    if (overId.startsWith('col-')) {
      setActiveId(null);
      const collectionId = overId.replace('col-', '');
      collectionApi
        .addMemo(collectionId, String(active.id))
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['collections'] });
          queryClient.invalidateQueries({ queryKey: ['memos'] });
        })
        .catch((e) => console.error('Failed to add memo to collection:', e));
      return;
    }

    // A Space, or a collection inside one. A Space is a workspace rather than a
    // label (ADR-020), so this MOVES the memo: it leaves the library and the
    // dashboard. The grid drops it immediately for that reason — waiting for
    // the refetch would leave the card sitting somewhere it no longer belongs.
    if (overId.startsWith('space-') || overId.startsWith('spacecol-')) {
      setActiveId(null);
      const memoId = String(active.id);
      const [spaceId, collectionId] = overId.startsWith('spacecol-')
        ? overId.replace('spacecol-', '').split(':')
        : [overId.replace('space-', ''), undefined];
      setLocalMemos((prev) => prev.filter((m) => m.id !== memoId));
      memoApi
        .move(memoId, spaceId, collectionId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['memos'] });
          queryClient.invalidateQueries({ queryKey: ['collections'] });
          queryClient.invalidateQueries({ queryKey: ['spaces'] });
        })
        .catch((e) => {
          console.error('Failed to move memo into the Space:', e);
          // Put it back: a failed move must not look like a successful one.
          setLocalMemos(serverMemos);
        });
      return;
    }

    const finalMemos = dragOrderRef.current;
    if (!finalMemos.length) {
      setActiveId(null);
      return;
    }
    reorderingRef.current = true;
    setActiveId(null);
    // Drag-to-reorder writes recency_at on each card: top card gets NOW,
    // each next card gets 1s earlier. The result is the dragged order,
    // and a brand-new memo created later still lands on top because its
    // recency_at = NOW() is later than every rewritten value.
    const base = Date.now();
    Promise.all(
      finalMemos.map((m, i) => memoApi.setRecency(m.id, new Date(base - i * 1000).toISOString()))
    )
      .then(() => {
        reorderingRef.current = false;
        queryClient.invalidateQueries({ queryKey: ['memos'] });
      })
      .catch((e) => {
        console.error('Failed to reorder memos:', e);
        reorderingRef.current = false;
        setLocalMemos(serverMemos);
      });
  };

  const activeMemo = activeId ? localMemos.find((m) => m.id === activeId) : null;

  // Ordered image/video memos — the lightbox pages prev/next across these.
  const mediaGroup = localMemos.filter((m) => m.type === 'image' || m.type === 'video');

  // Register drag handlers with the app-level DndContext (hosted in Layout so
  // the Sidebar's collection drop targets share the same provider). Cleared on
  // unmount so leaving the dashboard doesn't leave stale handlers wired up.
  // eslint-disable-next-line react-hooks/immutability -- effect intentionally writes the shared handler-bus ref each render to keep handlers fresh (CLAUDE.md dnd bus)
  useEffect(() => {
    if (!dndBus) return;
    // eslint-disable-next-line react-hooks/immutability -- intentional cross-component handler bus shared via a ref (see CLAUDE.md dnd bus)
    dndBus.current = {
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragEnd: handleDragEnd,
    };
    return () => {
      if (dndBus) dndBus.current = {};
    };
  });

  if (localMemos.length === 0) {
    return (
      <div className="om-empty">
        <div className="om-empty-mark">
          <Icon name="sparkles" size={26} />
        </div>
        <span className="mono om-greet-eyebrow">Nothing here yet</span>
        <h2>No Memos yet</h2>
        <p>Hit the + button to save your first link, note, file, or video.</p>
      </div>
    );
  }

  return (
    <>
      <SortableContext items={localMemos.map((m) => m.id)} strategy={verticalListSortingStrategy}>
        <div className="om-grid-wrap">
          {/* One keyed layer per filter set: the whole grid crossfades on a
              filter change instead of snapping. Only this wrapper animates — the
              thousands of cards inside don't each animate — so it stays cheap.
              mode="wait" means the old set is gone before the new mounts (never
              both at once). */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={transitionKey ?? 'all'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
            >
              <div
                className="om-masonry-grid"
                style={{
                  ['--grid-cols' as string]: columns,
                  ['--grid-gap' as string]: `${gap}px`,
                  columnGap: gap,
                }}
              >
                {localMemos.map((memo) => (
                  <MasonryCell
                    key={memo.id}
                    gap={gap}
                    // A wide card needs a second column to exist — on the phone's
                    // single column it renders normal.
                    wide={memo.card_size === 'wide' && columns > 1}
                  >
                    <SortableMemoCard memo={memo} anyDragActive={!!activeId} lightboxGroup={mediaGroup} transitionKey={transitionKey} dragDisabled={dragDisabled} />
                  </MasonryCell>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </SortableContext>

      {/* Rendered into the app-level DndContext hosted by Layout. */}
      <DragOverlay dropAnimation={null}>
        {activeMemo ? (
          <motion.div
            initial={{ scale: 1, rotate: 0, opacity: 1 }}
            animate={{ scale: 1.05, rotate: 2, opacity: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <MemoCard memo={activeMemo} />
          </motion.div>
        ) : null}
      </DragOverlay>
    </>
  );
}
