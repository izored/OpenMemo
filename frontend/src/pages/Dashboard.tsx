import { useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MemoGrid } from '@/components/MemoGrid';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { useAppStore } from '@/stores/appStore';
import { memoApi, collectionApi } from '@/lib/api';
import { MEMO_FILTERS, filterToParams, type MemoFilterDef } from '@/lib/memoFilters';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';

type FilterDef = MemoFilterDef;

// One draggable filter tab. distance:8 on the sensor keeps plain clicks
// (selecting a filter) working — only a real drag starts a reorder.
function SortableFilterTab({ f, active, onSelect }: { f: FilterDef; active: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: f.id });
  return (
    <button
      ref={setNodeRef}
      className={cn('om-filter-tab', active && 'active')}
      onClick={onSelect}
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : undefined,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
      {...attributes}
      {...listeners}
    >
      {active && (
        <motion.span
          layoutId="om-filter-pill"
          className="om-filter-pill"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      )}
      <span style={{ position: 'relative', zIndex: 1 }}>{f.label}</span>
    </button>
  );
}

// The filter set + the id→params mapping live in @/lib/memoFilters so the
// Space home (SpacePage) shows the exact same tabs.
const FILTERS = MEMO_FILTERS;

export function Dashboard() {
  const { activeFilter, setActiveFilter, activeCollection, setActiveCollection, filterOrder, setFilterOrder } = useAppStore();

  // Apply the user's saved tab order, reconciled with the current FILTERS set
  // (new tabs like Code/Audio get appended; removed ids are dropped).
  const orderedFilters = useMemo(() => {
    const byId = new Map(FILTERS.map((f) => [f.id, f]));
    const seen = new Set<string>();
    const out: FilterDef[] = [];
    for (const id of filterOrder) {
      const f = byId.get(id);
      if (f && !seen.has(id)) { out.push(f); seen.add(id); }
    }
    for (const f of FILTERS) if (!seen.has(f.id)) out.push(f);
    return out;
  }, [filterOrder]);

  const tabSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleTabDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = orderedFilters.map((f) => f.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    setFilterOrder(arrayMove(ids, from, to));
  };

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
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <PageHeader
        eyebrow={today}
        title={<>{collection ? collection.name : 'Today'}{import.meta.env.DEV && <span style={{color:'red',fontSize:'0.5em'}}> DEV</span>}</>}
        sub={collection ? `Everything filed under ${collection.name}.` : "A quiet place for what you're keeping."}
        back={collection ? { label: 'Back to Collections', onClick: () => { setActiveCollection(null); navigate('/collections'); } } : undefined}
      >
        <DndContext sensors={tabSensors} collisionDetection={closestCenter} onDragEnd={handleTabDragEnd}>
          <SortableContext items={orderedFilters.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
            <div className="om-filter-tabs">
              {orderedFilters.map((f) => (
                <SortableFilterTab
                  key={f.id}
                  f={f}
                  active={activeFilter === f.id}
                  onSelect={() => setActiveFilter(f.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </PageHeader>

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
    </>
  );
}
