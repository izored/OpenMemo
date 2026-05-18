import {
  DndContext,
  useSensor,
  useSensors,
  PointerSensor,
  DragOverlay,
  pointerWithin,
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

interface MemoGridProps {
  memos: Memo[];
}

function SortableMemoCard({ memo, anyDragActive }: { memo: Memo; anyDragActive: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: memo.id });
  return (
    <motion.div
      ref={setNodeRef}
      layout={!anyDragActive}
      layoutId={memo.id}
      transition={{ layout: { duration: 0.25, ease: [0.25, 1, 0.5, 1] } }}
      style={{ opacity: isDragging ? 0 : 1 }}
    >
      <MemoCard memo={memo} dragHandleProps={{ attributes, listeners: listeners || {} }} />
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

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localMemos, setLocalMemos] = useState(serverMemos);
  const reorderingRef = useRef(false);
  const dragOrderRef = useRef<Memo[]>([]);
  const lastOverIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId && !reorderingRef.current) setLocalMemos(serverMemos);
  }, [serverMemos, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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
    setActiveId(null);
    lastOverIdRef.current = null;

    if (over && String(over.id).startsWith('col-')) {
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
    if (!finalMemos.length) return;
    reorderingRef.current = true;
    Promise.all(finalMemos.map((m, i) => memoApi.updateSort(m.id, finalMemos.length - i)))
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
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => {
        setActiveId(String(e.active.id));
        lastOverIdRef.current = null;
        dragOrderRef.current = [...localMemos];
      }}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={localMemos.map((m) => m.id)} strategy={verticalListSortingStrategy}>
        <div
          className="om-grid-wrap"
          style={{ maxWidth: 'var(--page-max)', marginInline: 'auto' }}
        >
          <Masonry
            breakpointCols={breakpointCols}
            className="om-masonry"
            columnClassName="om-masonry-col"
            style={{ gap }}
          >
            {localMemos.map((memo) => (
              <div key={memo.id} style={{ marginBottom: gap }}>
                <SortableMemoCard memo={memo} anyDragActive={!!activeId} />
              </div>
            ))}
          </Masonry>
        </div>
      </SortableContext>

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
    </DndContext>
  );
}
