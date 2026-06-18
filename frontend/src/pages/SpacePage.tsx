import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { spaceApi, memoApi, collectionApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { MEMO_FILTERS, filterToParams } from '@/lib/memoFilters';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';

function band(color: string): string {
  const c = color || '#6366F1';
  return `linear-gradient(120deg, ${c} 0%, color-mix(in oklab, ${c} 60%, #14131c) 65%, color-mix(in oklab, ${c} 28%, #0c0b12) 100%)`;
}

// Pull the Y% out of a stored "50% 30%" focal point (X stays centered).
function parsePosY(s?: string | null): number {
  if (!s) return 50;
  const parts = s.trim().split(/\s+/);
  const y = parseFloat(parts[1] ?? parts[0]);
  return Number.isNaN(y) ? 50 : Math.max(0, Math.min(100, y));
}

export function SpacePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startPos: number } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [reposing, setReposing] = useState(false);
  const [posY, setPosY] = useState(50);
  const {
    activeSpace, setActiveSpace,
    activeCollection, setActiveCollection,
    activeFilter, setActiveFilter,
    setEditingSpace, setSpaceModalOpen,
  } = useAppStore();

  // Entering the route IS being inside the Space. Keep the store in sync so the
  // sidebar, the FAB add target, and the lists all scope to it.
  useEffect(() => {
    if (id && activeSpace !== id) setActiveSpace(id);
  }, [id, activeSpace, setActiveSpace]);

  const { data: space } = useQuery({
    queryKey: ['space', id],
    queryFn: () => spaceApi.get(id),
    enabled: !!id,
  });

  const { data: collections = [] } = useQuery({
    queryKey: ['collections', id],
    queryFn: () => collectionApi.list(id),
    enabled: !!id,
  });
  const activeColl = activeCollection
    ? (collections as Collection[]).find((c) => c.id === activeCollection)
    : null;

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['memos', 'space', id, activeCollection, activeFilter],
    queryFn: ({ pageParam }) =>
      memoApi.list({
        workspace_id: id,
        collection_id: activeCollection || undefined,
        ...filterToParams(activeFilter),
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!id,
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

  const onPickCover = async (f: File | null) => {
    if (!f || !id) return;
    setCoverBusy(true);
    try {
      await spaceApi.uploadCover(id, f);
      queryClient.invalidateQueries({ queryKey: ['space', id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } finally {
      setCoverBusy(false);
    }
  };
  const removeCover = async () => {
    if (!id) return;
    setCoverBusy(true);
    try {
      await spaceApi.deleteCover(id);
      queryClient.invalidateQueries({ queryKey: ['space', id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } finally {
      setCoverBusy(false);
    }
  };

  // ── Reposition (Notion-style: drag the cover up/down to set the focal point)
  const startRepos = () => { setPosY(parsePosY(space?.cover_pos)); setReposing(true); };
  const cancelRepos = () => { setReposing(false); dragRef.current = null; };
  const saveRepos = async () => {
    setReposing(false);
    if (!id) return;
    await spaceApi.update(id, { cover_pos: `50% ${Math.round(posY)}%` });
    queryClient.invalidateQueries({ queryKey: ['space', id] });
    queryClient.invalidateQueries({ queryKey: ['spaces'] });
  };
  const onBandPointerDown = (e: React.PointerEvent) => {
    if (!reposing) return;
    bandRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startPos: posY };
  };
  const onBandPointerMove = (e: React.PointerEvent) => {
    if (!reposing || !dragRef.current) return;
    const h = bandRef.current?.offsetHeight || 200;
    const dy = e.clientY - dragRef.current.startY;
    // Dragging down reveals more of the top of the image (position Y decreases).
    const next = dragRef.current.startPos - (dy / h) * 100;
    setPosY(Math.max(0, Math.min(100, next)));
  };
  const onBandPointerUp = () => { dragRef.current = null; };

  const hasCover = !!space?.cover_url;
  const coverPos = reposing ? `50% ${posY}%` : (space?.cover_pos || '50% 50%');

  return (
    <div className="om-space-page">
      {/* The Space wears its own header, not the shared PageHeader (ADR-020).
          It animates in on mount so navigating into a Space eases rather than
          hard-cutting from the dashboard's shared header. */}
      <motion.header
        className={cn('om-space-header', hasCover && 'has-cover', reposing && 'reposing')}
        style={{ ['--space-hue' as string]: space?.color || '#6366F1' }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div
          ref={bandRef}
          className="om-space-header-band"
          style={hasCover
            ? { backgroundImage: `url(${space?.cover_url})`, backgroundPosition: coverPos }
            : { background: band(space?.color || '#6366F1') }}
          onPointerDown={onBandPointerDown}
          onPointerMove={onBandPointerMove}
          onPointerUp={onBandPointerUp}
        >
          {!hasCover && <div className="om-hero-noise" />}
          {reposing && <div className="om-space-repos-hint mono">Drag to reposition</div>}
          {space && !reposing && (
            <button
              className="om-space-edit"
              onClick={() => { setEditingSpace(space); setSpaceModalOpen(true); }}
              title="Edit Space"
            >
              <Icon name="edit" size={14} />
            </button>
          )}
          <div className="om-space-cover-actions">
            {reposing ? (
              <>
                <button className="om-space-cover-btn" onClick={cancelRepos} type="button">Cancel</button>
                <button className="om-space-cover-btn primary" onClick={saveRepos} type="button">Save position</button>
              </>
            ) : (
              <>
                <button className="om-space-cover-btn" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} title={hasCover ? 'Change cover' : 'Add cover'}>
                  <Icon name="image" size={12} />
                  <span>{coverBusy ? 'Uploading…' : hasCover ? 'Change cover' : 'Add cover'}</span>
                </button>
                {hasCover && (
                  <button className="om-space-cover-btn" onClick={startRepos} title="Reposition cover">
                    <Icon name="move" size={12} />
                    <span>Reposition</span>
                  </button>
                )}
                {hasCover && (
                  <button className="om-space-cover-btn" onClick={removeCover} disabled={coverBusy} title="Remove cover">
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={(e) => onPickCover(e.target.files?.[0] || null)} />
        <div className="om-space-identity">
          <span className="om-space-emoji" aria-hidden>{space?.emoji || '🗂️'}</span>
          <div className="om-space-identity-text">
            <h1 className="om-space-name">{space?.name || 'Space'}</h1>
            <p className="om-space-sub">
              {activeColl ? (
                <>Filed under <b>{activeColl.name}</b> · <button className="om-link-btn" onClick={() => setActiveCollection(null)}>show all</button></>
              ) : (
                space?.description || 'A separate place for a bigger project.'
              )}
            </p>
          </div>
          <div className="om-space-stats mono">
            <span>{space?.counts?.memos ?? memos.length} Memos</span>
            <span>{space?.counts?.collections ?? collections.length} Collections</span>
          </div>
        </div>
      </motion.header>

      {/* Type filters, same set as the dashboard, back under the cover. */}
      <motion.div
        className="om-space-filters"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08, duration: 0.25 }}
      >
        <div className="om-filter-tabs">
          {MEMO_FILTERS.map((f) => (
            <button
              key={f.id}
              className={cn('om-filter-tab', activeFilter === f.id && 'active')}
              onClick={() => setActiveFilter(f.id)}
              style={{ position: 'relative' }}
            >
              {activeFilter === f.id && (
                <motion.span
                  layoutId="om-space-filter-pill"
                  className="om-filter-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>{f.label}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {isLoading ? (
        <div className="om-empty">
          <div className="om-empty-mark"><Icon name="refresh" size={24} /></div>
          <p>Loading…</p>
        </div>
      ) : memos.length === 0 ? (
        <div className="om-empty">
          <div className="om-empty-mark"><Icon name="layers" size={24} /></div>
          <p>{activeFilter === 'all'
            ? 'This Space is empty. Add a memo and it lands here, not in your main library.'
            : 'Nothing of this type in the Space yet.'}</p>
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
  );
}
