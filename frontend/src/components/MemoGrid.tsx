import { DndContext, useSensor, useSensors, PointerSensor, DragOverlay, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { MemoCard } from './MemoCard';
import { collectionApi, memoApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Memo } from '@/types';

interface MemoGridProps {
  memos: Memo[];
}

function SortableMemoCard({ memo }: { memo: Memo }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: memo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <MemoCard memo={memo} dragHandleProps={{ attributes, listeners: listeners || {} }} />
    </div>
  );
}

export function MemoGrid({ memos }: MemoGridProps) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const overId = String(over.id);

    // Check if dropped on a collection (sidebar droppable)
    if (overId.startsWith('col-')) {
      const collectionId = overId.replace('col-', '');
      const memoId = String(active.id);
      try {
        await collectionApi.addMemo(collectionId, memoId);
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        queryClient.invalidateQueries({ queryKey: ['memos'] });
      } catch (e) {
        console.error('Failed to add memo to collection:', e);
      }
      return;
    }

    // Sort reorder within grid
    const oldIndex = memos.findIndex((m) => m.id === active.id);
    const newIndex = memos.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newMemos = arrayMove(memos, oldIndex, newIndex);
    try {
      await Promise.all(
        newMemos.map((m, i) => memoApi.updateSort(m.id, newMemos.length - i))
      );
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    } catch (e) {
      console.error('Failed to reorder memos:', e);
    }
  };

  const activeMemo = activeId ? memos.find((m) => m.id === activeId) : null;

  if (memos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-24 h-24 rounded-full bg-[var(--color-brand-light)] flex items-center justify-center mb-6">
          <span className="text-4xl">&#128218;</span>
        </div>
        <h3 className="text-xl font-bold text-[var(--color-text)] mb-3 tracking-tight">
          No memos yet
        </h3>
        <p className="text-[15px] text-[var(--color-text-secondary)] max-w-sm leading-relaxed">
          Start by saving your first article, note, or file. Use the &quot;Add New&quot;
          button below.
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={memos.map((m) => m.id)} strategy={rectSortingStrategy}>
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {memos.map((memo) => (
              <SortableMemoCard key={memo.id} memo={memo} />
            ))}
          </div>
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeMemo ? (
          <div className="opacity-80 rotate-2 scale-105">
            <MemoCard memo={activeMemo} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
