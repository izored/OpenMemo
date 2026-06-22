import { useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { MemoGrid } from '@/components/MemoGrid';
import { BottomBar } from '@/components/BottomBar';
import { BottomBarFilters } from '@/components/BottomBarFilters';
import { IslandFab } from '@/components/IslandFab';
import { AddMemoPanel } from '@/components/AddMemoPanel';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { memoApi, collectionApi } from '@/lib/api';
import { MEMO_FILTERS, filterToParams, type MemoFilterDef } from '@/lib/memoFilters';
import type { Collection } from '@/types';

const FILTERS: MemoFilterDef[] = MEMO_FILTERS;

export function Dashboard() {
  const {
    activeFilter, setActiveFilter,
    activeCollection, setActiveCollection,
    filterOrder,
    setAddPanelOpen,
    addPanelOpen,
  } = useAppStore();

  // Apply saved tab order without drag-to-reorder (DnD re-added in next iteration).
  const orderedFilters = useMemo(() => {
    const byId = new Map(FILTERS.map((f) => [f.id, f]));
    const seen = new Set<string>();
    const out: MemoFilterDef[] = [];
    for (const id of filterOrder) {
      const f = byId.get(id);
      if (f && !seen.has(id)) { out.push(f); seen.add(id); }
    }
    for (const f of FILTERS) if (!seen.has(f.id)) out.push(f);
    return out;
  }, [filterOrder]);

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionApi.list(),
  });

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['memos', activeFilter, activeCollection],
    queryFn: ({ pageParam }) => {
      const params: { type?: string; audio_kind?: 'voice' | 'music'; collection_id?: string; offset?: number } = {
        ...filterToParams(activeFilter),
      };
      if (activeCollection) params.collection_id = activeCollection;
      params.offset = pageParam;
      return memoApi.list(params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const memos = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const navigate = useNavigate();
  const collection = activeCollection
    ? collections.find((c: Collection) => c.id === activeCollection)
    : null;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const barLabel = collection ? collection.name : today;

  // The FAB IS the New Memo modal, collapsed (ADR-021). IslandFab grows the
  // little square up-and-left into the embedded form (true single-surface morph),
  // and the bar drops its filters to shrink to the cog while open.
  const fab = (
    <IslandFab open={addPanelOpen} onOpenChange={setAddPanelOpen} icon="plus" label="New Memo">
      <AddMemoPanel embedded />
    </IslandFab>
  );

  return (
    <div className="om-bbar-page">
      <div style={{ flex: 1, minHeight: 0 }}>
        {isLoading ? (
          <div className="om-empty">
            <div className="om-empty-mark">
              <Icon name="refresh" size={24} />
            </div>
            <p>Loading Memos…</p>
          </div>
        ) : (
          <>
            <MemoGrid memos={memos} />
            <div ref={sentinelRef} style={{ height: 1 }} />
            {isFetchingNextPage && (
              <div className="om-empty">
                <div className="om-empty-mark"><Icon name="refresh" size={24} /></div>
                <p>Loading more…</p>
              </div>
            )}
          </>
        )}
      </div>

      <BottomBar label={barLabel} fab={fab} fabExpanded={addPanelOpen}>
        <BottomBarFilters
          filters={orderedFilters}
          active={activeFilter}
          onChange={(id) => {
            setActiveFilter(id);
            if (activeCollection) {
              setActiveCollection(null);
              navigate('/');
            }
          }}
        />
      </BottomBar>
    </div>
  );
}
