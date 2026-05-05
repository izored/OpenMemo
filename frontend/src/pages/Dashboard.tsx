import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { MemoGrid } from '@/components/MemoGrid';
import { useAppStore } from '@/stores/appStore';
import { memoApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const filterTabs = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'link', label: 'Links' },
  { id: 'video', label: 'Videos' },
  { id: 'note', label: 'Notes' },
  { id: 'document', label: 'Files' },
];

export function Dashboard() {
  const {
    activeFilter,
    setActiveFilter,
    activeCollection,
    setSearchOpen,
  } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ['memos', activeFilter, activeCollection],
    queryFn: () => {
      const params: { type?: string; collection_id?: string } = {};
      if (activeFilter !== 'all') {
        if (activeFilter === 'link') {
          params.type = 'link';
        } else {
          params.type = activeFilter;
        }
      }
      if (activeCollection) {
        params.collection_id = activeCollection;
      }
      return memoApi.list(params);
    },
  });

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-end pt-4 pb-4">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-3 px-6 py-3 bg-white/80 backdrop-blur-sm rounded-full text-[15px] text-[#646464] hover:bg-white transition-colors shadow-sm"
        >
          <Search size={17} />
          <span className="font-medium">Search</span>
          <kbd className="text-[11px] px-2.5 py-1 bg-white/50 rounded-md ml-1 font-mono border border-black/10">
            Ctrl+K
          </kbd>
        </button>
      </header>

      {/* Filter tabs */}
      <div className="pt-8 pb-14">
        <div className="flex gap-3 flex-wrap justify-center">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                'px-6 py-3 rounded-full text-base font-semibold transition-all',
                activeFilter === tab.id
                  ? 'bg-[#202020] text-white shadow-md'
                  : 'bg-white/70 text-[#646464] hover:bg-white shadow-sm'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-16">
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-10 h-10 border-[2.5px] border-[#202020] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MemoGrid memos={data?.items || []} />
        )}
      </div>
    </div>
  );
}
