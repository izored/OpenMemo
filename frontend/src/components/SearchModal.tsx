import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, FileText, Globe, Image, Video, Mic, File } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { searchApi } from '@/lib/api';

export function SearchModal() {
  const { searchOpen, setSearchOpen } = useAppStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen, setSearchOpen]);

  // Focus input
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [searchOpen]);

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchApi.search(query);
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (!searchOpen) return null;

  const typeIcons: Record<string, any> = {
    note: FileText,
    article: Globe,
    image: Image,
    video: Video,
    audio: Mic,
    document: File,
    link: Globe,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setSearchOpen(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E5E7EB]">
          <Search size={20} className="text-[#9CA3AF] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your memos..."
            className="flex-1 text-sm outline-none placeholder:text-[#9CA3AF]"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 bg-[#F3F4F6] rounded text-[#6B7280]">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-5 py-4 text-sm text-[#6B7280]">Searching...</div>
          )}
          {!loading && results.length === 0 && query && (
            <div className="px-5 py-8 text-center text-sm text-[#6B7280]">No results found</div>
          )}
          {results.map((result: any) => {
            const Icon = typeIcons[result.type] || FileText;
            return (
              <button
                key={result.id}
                onClick={() => {
                  navigate(`/memo/${result.id}`);
                  setSearchOpen(false);
                }}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#F3F4F6] text-left transition-colors"
              >
                <Icon size={16} className="text-[#6B7280] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1F2937] truncate">{result.title}</p>
                  {result.description && (
                    <p className="text-xs text-[#6B7280] truncate">{result.description}</p>
                  )}
                </div>
                <span className="text-xs text-[#9CA3AF]">{result.source_domain}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
