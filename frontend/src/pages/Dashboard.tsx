import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { memoApi, collectionApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Collection, Memo } from '@/types';

const SORTS = [
  { id: 'recent', label: 'Recent' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title' },
  { id: 'custom', label: 'Custom order' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'link', label: 'Links' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Files' },
];

export function Dashboard() {
  const { activeFilter, setActiveFilter, activeCollection } = useAppStore();
  const [sort, setSort] = useState<SortId>('recent');
  const [sortMenu, setSortMenu] = useState(false);

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['memos', activeFilter, activeCollection],
    queryFn: () => {
      const params: { type?: string; collection_id?: string } = {};
      if (activeFilter !== 'all') params.type = activeFilter;
      if (activeCollection) params.collection_id = activeCollection;
      return memoApi.list(params);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const sortedMemos = useMemo(() => {
    const items: Memo[] = [...(data?.items || [])];
    if (sort === 'recent')
      items.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    else if (sort === 'oldest')
      items.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    else if (sort === 'title')
      items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'custom')
      items.sort((a, b) => {
        const so = (b.sort_order ?? 0) - (a.sort_order ?? 0);
        if (so !== 0) return so;
        return +new Date(b.created_at) - +new Date(a.created_at);
      });
    return items;
  }, [data, sort]);

  const collection = activeCollection
    ? collections.find((c: Collection) => c.id === activeCollection)
    : null;
  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? 'Recent';
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
          <div style={{ position: 'relative' }}>
            <button className="om-sort-btn" onClick={() => setSortMenu((v) => !v)}>
              <span className="mono om-sort-label">Sort</span>
              <span>{sortLabel}</span>
              <Icon name="chevronDown" size={10} />
            </button>
            {sortMenu && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9 }}
                  onClick={() => setSortMenu(false)}
                />
                <div className="om-sort-menu">
                  {SORTS.map((s) => (
                    <button
                      key={s.id}
                      className={cn('om-sort-opt', sort === s.id && 'active')}
                      onClick={() => {
                        setSort(s.id);
                        setSortMenu(false);
                      }}
                    >
                      {s.label}
                      {sort === s.id && <Icon name="check" size={11} />}
                    </button>
                  ))}
                </div>
              </>
            )}
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
        <MemoGrid memos={sortedMemos} />
      )}
    </>
  );
}
