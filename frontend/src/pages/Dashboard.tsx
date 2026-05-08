import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, FileText, Globe, Image as ImageIcon, Video, Mic, File, Link2, Menu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MemoGrid } from '@/components/MemoGrid';
import { useAppStore } from '@/stores/appStore';
import { memoApi, searchApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Memo } from '@/types';

const filterTabs = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Image' },
  { id: 'link', label: 'Links' },
  { id: 'video', label: 'Videos' },
  { id: 'note', label: 'Notes' },
  { id: 'document', label: 'Files' },
];

const typeIcons: Record<string, React.ElementType> = {
  note: FileText,
  article: Globe,
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: File,
  link: Link2,
};

const GREETINGS = [
  "Hi there! New memo to add?",
  "Welcome back, ready to capture something?",
  "What's on your mind today?",
  "Your knowledge base is growing 🌱",
  "Ready to memo?",
  "Capture an idea before it fades ✨",
  "Build your second brain, one memo at a time.",
  "What are you learning today?",
  "Drop a link, save a thought.",
  "OpenMemo — your ideas, organized.",
];

function getDailyGreeting(): string {
  const today = new Date().toISOString().slice(0, 10);
  const saved = localStorage.getItem('openmemo_greeting');
  if (saved) {
    try {
      const { date, index } = JSON.parse(saved);
      if (date === today) return GREETINGS[index % GREETINGS.length];
    } catch { /* ignore */ }
  }
  const index = Math.floor(Math.random() * GREETINGS.length);
  localStorage.setItem('openmemo_greeting', JSON.stringify({ date: today, index }));
  return GREETINGS[index];
}

export function Dashboard() {
  const {
    activeFilter,
    setActiveFilter,
    activeCollection,
    sidebarOpen,
    toggleSidebar,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Memo[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [greeting] = useState(() => getDailyGreeting());
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
  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleResultClick = useCallback((id: string) => {
    navigate(`/memo/${id}`);
    setSearchQuery('');
    setSearchResults([]);
  }, [navigate]);

  const showResults = searchFocused && (searchQuery.trim().length > 0 || searchResults.length > 0);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar — hamburger + greeting + filters(centered) + search, all on one line */}
      <header className="flex items-center gap-3 pt-4 pb-4">
        {/* Hamburger — owns this slot on dashboard; Layout's hamburger is hidden on '/' */}
        <button
          onClick={toggleSidebar}
          className="p-2.5 rounded-full hover:bg-[var(--color-bg-hover)] transition-all duration-150 cursor-pointer flex-shrink-0"
          style={{ opacity: sidebarOpen ? 0 : 1, pointerEvents: sidebarOpen ? 'none' : 'auto' }}
          title="Open sidebar"
        >
          <Menu size={20} className="text-[var(--color-text-secondary)]" />
        </button>

        {/* Greeting — left-aligned */}
        <h2 className="text-lg font-bold text-[var(--color-text)] tracking-tight whitespace-nowrap flex-shrink-0">
          {greeting}
        </h2>

        {/* Filter tabs — centered within remaining space */}
        <div className="flex gap-1.5 flex-1 justify-center flex-wrap">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-semibold transition-all whitespace-nowrap cursor-pointer',
                activeFilter === tab.id
                  ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)] shadow-md'
                  : 'bg-[var(--color-bg-card)]/70 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] shadow-sm'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search — right-aligned */}
        <div className="relative flex-shrink-0">
          <div
            className={cn(
              'flex items-center gap-3 px-5 py-3 bg-[var(--color-bg-card)] rounded-full text-[15px] text-[var(--color-text-secondary)] transition-all shadow-sm',
              searchFocused ? 'ring-2 ring-[var(--color-text)] w-80' : 'hover:bg-[var(--color-bg-card)] w-64'
            )}
          >
            <Search size={17} className="text-[var(--color-text-muted)] flex-shrink-0" />
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
              placeholder="Search memos…  Ctrl+K"
              className="flex-1 bg-transparent outline-none placeholder:text-[var(--color-text-muted)] text-[var(--color-text)] text-sm"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setSearchResults([]); }}>
                <X size={14} className="text-[var(--color-text-muted)]" />
              </button>
            )}
          </div>

          {/* Search results dropdown */}
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--color-bg-card)] rounded-2xl shadow-xl border border-[var(--color-border)] overflow-hidden z-50">
              {searchLoading && (
                <div className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">Searching...</div>
              )}
              {!searchLoading && searchResults.length === 0 && searchQuery.trim() && (
                <div className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">No results found</div>
              )}
              {!searchLoading && searchResults.map((result) => {
                const Icon = typeIcons[result.type] || FileText;
                return (
                  <button
                    key={result.id}
                    onMouseDown={() => handleResultClick(result.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-bg-hover)] text-left transition-colors"
                  >
                    <Icon size={15} className="text-[var(--color-text-secondary)] flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{result.title}</p>
                      {result.description && (
                        <p className="text-xs text-[var(--color-text-secondary)] truncate">{result.description}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--color-text-muted)] font-mono">{result.source_domain}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-16">
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-10 h-10 border-[2.5px] border-[var(--color-text)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MemoGrid memos={data?.items || []} />
        )}
      </div>
    </div>
  );
}
