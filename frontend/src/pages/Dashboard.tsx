import { useQuery } from '@tanstack/react-query';
import { Grid3X3, List, Clock, Search, Menu } from 'lucide-react';
import { MemoGrid } from '@/components/MemoGrid';
import { useAppStore } from '@/stores/appStore';
import { memoApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const filterTabs = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'article', label: 'Links' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audios' },
];

export function Dashboard() {
  const {
    activeFilter,
    setActiveFilter,
    viewMode,
    setViewMode,
    activeCollection,
    sidebarOpen,
    toggleSidebar,
    setSearchOpen,
  } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ['memos', activeFilter, activeCollection],
    queryFn: () =>
      memoApi.list({
        type: activeFilter !== 'all' ? activeFilter : undefined,
        collection_id: activeCollection || undefined,
      }),
  });

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-3">
          {!sidebarOpen && (
            <button onClick={toggleSidebar} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]">
              <Menu size={20} className="text-[#6B7280]" />
            </button>
          )}
          <h1 className="text-xl font-semibold text-[#1F2937]">
            {activeCollection ? 'Collection' : 'All Memos'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[#F3F4F6] rounded-lg text-sm text-[#6B7280] hover:bg-[#E5E7EB] transition-colors"
          >
            <Search size={16} />
            <span>Search</span>
            <kbd className="text-[10px] px-1 py-0.5 bg-white rounded ml-2">Ctrl+K</kbd>
          </button>
        </div>
      </header>

      {/* Filter tabs + view toggles */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#E5E7EB]">
        <div className="flex gap-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                activeFilter === tab.id
                  ? 'bg-[#FEF3C7] text-[#D97706]'
                  : 'text-[#6B7280] hover:bg-[#F3F4F6]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 border border-[#E5E7EB] rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded',
              viewMode === 'grid' ? 'bg-[#F3F4F6]' : 'hover:bg-[#F3F4F6]'
            )}
          >
            <Grid3X3 size={16} className="text-[#6B7280]" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1.5 rounded',
              viewMode === 'list' ? 'bg-[#F3F4F6]' : 'hover:bg-[#F3F4F6]'
            )}
          >
            <List size={16} className="text-[#6B7280]" />
          </button>
          <button
            onClick={() => setViewMode('timeline')}
            className={cn(
              'p-1.5 rounded',
              viewMode === 'timeline' ? 'bg-[#F3F4F6]' : 'hover:bg-[#F3F4F6]'
            )}
          >
            <Clock size={16} className="text-[#6B7280]" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#D97706] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MemoGrid memos={data?.items || []} />
        )}
      </div>
    </div>
  );
}
