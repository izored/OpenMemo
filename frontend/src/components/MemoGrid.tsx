import {
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { motion } from 'framer-motion';
import Masonry from 'react-masonry-css';
import { useState, useEffect, useRef } from 'react';
import { MemoCard } from './MemoCard';
import { Icon } from './Icon';
import { collectionApi, memoApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Memo } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { useDndBus } from '@/lib/dndBus';

interface MemoGridProps {
  memos: Memo[];
}

function SortableMemoCard({ memo, anyDragActive, lightboxGroup }: { memo: Memo; anyDragActive: boolean; lightboxGroup: Memo[] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: memo.id });
  return (
    <motion.div
      ref={setNodeRef}
      layout={!anyDragActive}
      layoutId={memo.id}
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
      if (w < 900) setCap(2);
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

export function MemoGrid({ memos: serverMemos }: MemoGridProps) {
  const queryClient = useQueryClient();
  const tweaks = useAppStore((s) => s.tweaks);
  const columns = useViewportColumns(tweaks.gridColumns || 4);
  const gap = tweaks.density === 'compact' ? 12 : tweaks.density === 'roomy' ? 28 : 20;

  const dndBus = useDndBus();
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
    if (overId.startsWith('col-')) return;
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

    if (over && String(over.id).startsWith('col-')) {
      setActiveId(null);
      const collectionId = String(over.id).replace('col-', '');
      collectionApi
        .addMemo(collectionId, String(active.id))
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['collections'] });
          queryClient.invalidateQueries({ queryKey: ['memos'] });
        })
        .catch((e) => console.error('Failed to add memo to collection:', e));
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

  const breakpointCols = {
    default: columns,
    1500: Math.min(columns, 4),
    1280: Math.min(columns, 3),
    900: 2,
  };

  return (
    <>
      <SortableContext items={localMemos.map((m) => m.id)} strategy={verticalListSortingStrategy}>
        <div className="om-grid-wrap">
          <Masonry
            breakpointCols={breakpointCols}
            className="om-masonry"
            columnClassName="om-masonry-col"
            style={{ gap }}
          >
            {localMemos.map((memo) => (
              <div key={memo.id} style={{ marginBottom: gap }}>
                <SortableMemoCard memo={memo} anyDragActive={!!activeId} lightboxGroup={mediaGroup} />
              </div>
            ))}
          </Masonry>
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
