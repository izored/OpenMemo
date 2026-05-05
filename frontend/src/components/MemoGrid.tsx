import { DndContext, useSensor, useSensors, PointerSensor, DragOverlay } from '@dnd-kit/core';
import { useState } from 'react';
import { MemoCard } from './MemoCard';
import { collectionApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { Memo } from '@/types';

interface MemoGridProps {
  memos: Memo[];
}

export function MemoGrid({ memos }: MemoGridProps) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      // over.id is a collection id (prefixed with 'col-' in sidebar droppables)
      const collectionId = String(over.id).replace('col-', '');
      const memoId = String(active.id);
      try {
        await collectionApi.addMemo(collectionId, memoId);
        queryClient.invalidateQueries({ queryKey: ['collections'] });
        queryClient.invalidateQueries({ queryKey: ['memos'] });
      } catch (e) {
        console.error('Failed to add memo to collection:', e);
      }
    }
  };

  const activeMemo = activeId ? memos.find((m) => m.id === activeId) : null;

  if (memos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-24 h-24 rounded-full bg-[#FEE4E0] flex items-center justify-center mb-6">
          <span className="text-4xl">&#128218;</span>
        </div>
        <h3 className="text-xl font-bold text-[#202020] mb-3 tracking-tight">
          No memos yet
        </h3>
        <p className="text-[15px] text-[#646464] max-w-sm leading-relaxed">
          Start by saving your first article, note, or file. Use the "Add New"
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
      <div className="max-w-[1280px] mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {memos.map((memo) => (
            <MemoCard key={memo.id} memo={memo} />
          ))}
        </div>
      </div>

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
