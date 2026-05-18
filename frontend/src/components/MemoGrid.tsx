// File: frontend/src/components/MemoGrid.tsx
import { DndContext, useSensor, useSensors, PointerSensor, DragOverlay, pointerWithin, type DragEndEvent, type DragOverEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { motion } from 'framer-motion';
import Masonry from 'react-masonry-css';
import { useState, useEffect, useRef } from 'react';
import { MemoCard } from './MemoCard';
import { collectionApi, memoApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Memo } from '@/types';
import { useAppStore } from '@/stores/appStore';

interface MemoGridProps {
  memos: Memo[];
}

function SortableMemoCard({ memo, anyDragActive }: { memo: Memo; anyDragActive: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: memo.id });

  // No dnd-kit transforms — array reorder controls positions, DragOverlay shows floating card
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

export function MemoGrid({ memos: serverMemos }: MemoGridProps) {
  const queryClient = useQueryClient();
  const dashboardGridColumns = useAppStore((s) => s.dashboardGridColumns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localMemos, setLocalMemos] = useState(serverMemos);
  const reorderingRef = useRef(false);
  const dragOrderRef = useRef<Memo[]>([]);  // synchronously updated during drag
  const lastOverIdRef = useRef<string | null>(null);

  const breakpointColumnsObj = {
    default: dashboardGridColumns,
    1280: dashboardGridColumns === 5 ? 4 : 3,
    1024: 3,
    640: 2,
  };

  useEffect(() => {
    if (!activeId && !reorderingRef.current) {
      setLocalMemos(serverMemos);
    }
  }, [serverMemos, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

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

    // collection drop — check first
    if (over && String(over.id).startsWith('col-')) {
      const collectionId = String(over.id).replace('col-', '');
      collectionApi.addMemo(collectionId, String(active.id))
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['collections'] });
          queryClient.invalidateQueries({ queryKey: ['memos'] });
        })
        .catch((e) => console.error('Failed to add memo to collection:', e));
      return;
    }

    // always persist — swaps already happened in onDragOver
    const finalMemos = dragOrderRef.current;
    if (!finalMemos.length) return;
    reorderingRef.current = true;

    Promise.all(
      finalMemos.map((m, i) => memoApi.updateSort(m.id, finalMemos.length - i))
    ).then(() => {
      reorderingRef.current = false;
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    }).catch((e) => {
      console.error('Failed to reorder memos:', e);
      reorderingRef.current = false;
      setLocalMemos(serverMemos);
    });
  };

  const activeMemo = activeId ? localMemos.find((m) => m.id === activeId) : null;

  if (localMemos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-24 h-24 rounded-full bg-[var(--color-brand-light)] flex items-center justify-center mb-6">
          <span className="text-4xl">&#128218;</span>
        </div>
        <h3 className="text-xl font-bold text-[var(--color-text)] mb-3 tracking-tight">
          No memos yet
        </h3>
        <p className="text-[15px] text-[var(--color-text-secondary)] max-w-sm leading-relaxed">
          Start by saving your first article, note, or file. Use the &quot;Add New&quot; button below.
        </p>
      </div>
    );
  }

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
        <div className="max-w-[1280px] mx-auto pb-4">
          <Masonry
            breakpointCols={breakpointColumnsObj}
            className="flex gap-4 w-full"
            columnClassName="flex flex-col gap-4"
          >
            {localMemos.map((memo) => (
              <SortableMemoCard key={memo.id} memo={memo} anyDragActive={!!activeId} />
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