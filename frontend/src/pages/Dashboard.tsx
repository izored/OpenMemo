import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, FileText, Globe, Image as ImageIcon, Video, Mic, File, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MemoGrid } from '@/components/MemoGrid';
import { useAppStore } from '@/stores/appStore';
import { memoApi, searchApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const filterTabs = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'link', label: 'Links' },
  { id: 'video', label: 'Videos' },
  { id: 'note', label: 'Notes' },
  { id: 'document', label: 'Files' },
];

const typeIcons: Record<string, any> = {
  note: FileText,
  article: Globe,
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: File,
  link: Link2,
};

export function Dashboard() {
  const {
    activeFilter,
    setActiveFilter,
    activeCollection,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

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
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Keyboard shortcut: Ctrl+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchApi.search(searchQuery);
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleResultClick = useCallback((id: string) => {
    navigate(`/memo/${id}`);
    setSearchQuery('');
    setSearchResults([]);
  }, [navigate]);

  const showResults = searchFocused && (searchQuery.trim().length > 0 || searchResults.length > 0);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-end pt-4 pb-4">
        <div className="relative">
          <div
            className={cn(
              'flex items-center gap-3 px-5 py-3 bg-white rounded-full text-[15px] text-[#646464] transition-all shadow-sm',
              searchFocused ? 'ring-2 ring-[#202020] w-80' : 'hover:bg-white w-64'
            )}
          >
            <Search size={17} className="text-[#8d8d8d] flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('');
                  setSearchResults([]);
                  searchInputRef.current?.blur();
                }
              }}
              placeholder="Search your memos..."
              className="flex-1 bg-transparent outline-none placeholder:text-[#8d8d8d] text-[#202020] text-sm"
            />
            {searchQuery ? (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); }}>
                <X size={14} className="text-[#8d8d8d]" />
              </button>
            ) : (
              <kbd className="text-[11px] px-2 py-0.5 bg-[#f5f5f5] rounded-md font-mono border border-[#e5e5e5] flex-shrink-0">
                Ctrl+K
              </kbd>
            )}
          </div>

          {/* Search results dropdown */}
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-[#e5e5e5] overflow-hidden z-50">
              {searchLoading && (
                <div className="px-4 py-3 text-sm text-[#646464]">Searching...</div>
              )}
              {!searchLoading && searchResults.length === 0 && searchQuery.trim() && (
                <div className="px-4 py-6 text-center text-sm text-[#646464]">No results found</div>
              )}
              {!searchLoading && searchResults.map((result: any) => {
                const Icon = typeIcons[result.type] || FileText;
                return (
                  <button
                    key={result.id}
                    onMouseDown={() => handleResultClick(result.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f5f5f5] text-left transition-colors"
                  >
                    <Icon size={15} className="text-[#646464] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#202020] truncate">{result.title}</p>
                      {result.description && (
                        <p className="text-xs text-[#646464] truncate">{result.description}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-[#8d8d8d] font-mono">{result.source_domain}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
