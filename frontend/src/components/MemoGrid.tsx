import { useMemo } from 'react';
import { MemoCard } from './MemoCard';
import { useAppStore } from '@/stores/appStore';
import type { Memo } from '@/types';

interface MemoGridProps {
  memos: Memo[];
}

export function MemoGrid({ memos }: MemoGridProps) {
  const viewMode = useAppStore((s) => s.viewMode);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, Memo[]> = {};
    for (const memo of memos) {
      const date = new Date(memo.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(memo);
    }
    return Object.entries(groups);
  }, [memos]);

  if (memos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-full bg-[#FEF3C7] flex items-center justify-center mb-4">
          <span className="text-3xl">&#128218;</span>
        </div>
        <h3 className="text-lg font-medium text-[#1F2937] mb-2">No memos yet</h3>
        <p className="text-sm text-[#6B7280] max-w-xs">
          Start by saving your first article, note, or file. Use the "Add New" button below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {grouped.map(([date, items]) => (
        <section key={date}>
          <h2 className="text-sm font-medium text-[#6B7280] mb-3 px-1">
            {date} — {items.length} Memo{items.length > 1 ? 's' : ''}
          </h2>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((memo) => (
                <MemoCard key={memo.id} memo={memo} view="grid" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((memo) => (
                <MemoCard key={memo.id} memo={memo} view="list" />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
