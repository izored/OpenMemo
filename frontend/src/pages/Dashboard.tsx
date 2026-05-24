import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { memoApi, collectionApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'link', label: 'Links' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Files' },
];

const SORTS: { id: 'recent' | 'oldest' | 'title' | 'custom'; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title' },
  { id: 'custom', label: 'Custom order' },
];

export function Dashboard() {
  const { activeFilter, setActiveFilter, activeCollection, sortMode, setSortMode } = useAppStore();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['memos', activeFilter, activeCollection, sortMode],
    queryFn: () => {
      const params: { type?: string; collection_id?: string; sort: typeof sortMode } = { sort: sortMode };
      if (activeFilter !== 'all') params.type = activeFilter;
      if (activeCollection) params.collection_id = activeCollection;
      return memoApi.list(params);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const memos = data?.items || [];

  const collection = activeCollection
    ? collections.find((c: Collection) => c.id === activeCollection)
    : null;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <header className="om-header">
        <div className="om-greet">
          <span className="om-greet-eyebrow mono">{today}</span>
          <h1 className="om-greet-title">{collection ? collection.name : 'Today'}</h1>
          <p className="om-greet-sub">
            {collection
              ? `Everything filed under ${collection.name}.`
              : "A quiet place for what you're keeping."}
          </p>
        </div>
        <div className="om-filter-rail">
          <div className="om-filter-tabs">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={cn('om-filter-tab', activeFilter === f.id && 'active')}
                onClick={() => setActiveFilter(f.id)}
                style={{ position: 'relative' }}
              >
                {activeFilter === f.id && (
                  <motion.span
                    layoutId="om-filter-pill"
                    className="om-filter-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  />
                )}
                <span style={{ position: 'relative', zIndex: 1 }}>{f.label}</span>
              </button>
            ))}
          </div>
          <div className="om-sort-wrap">
            <Icon name="chevronDown" size={11} />
            <select
              className="om-sort-select mono"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
              aria-label="Sort memos"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="om-empty">
          <div className="om-empty-mark">
            <Icon name="refresh" size={24} />
          </div>
          <p>Loading Memos…</p>
        </div>
      ) : (
        <MemoGrid memos={memos} />
      )}
    </>
  );
}
