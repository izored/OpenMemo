import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { MemoGrid } from '@/components/MemoGrid';
import { Icon } from '@/components/Icon';
import { spaceApi, memoApi, collectionApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Collection } from '@/types';

function band(color: string): string {
  const c = color || '#6366F1';
  return `linear-gradient(120deg, ${c} 0%, color-mix(in oklab, ${c} 60%, #14131c) 65%, color-mix(in oklab, ${c} 28%, #0c0b12) 100%)`;
}

export function SpacePage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const {
    activeSpace, setActiveSpace,
    activeCollection, setActiveCollection,
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
    queryKey: ['memos', 'space', id, activeCollection],
    queryFn: ({ pageParam }) =>
      memoApi.list({
        workspace_id: id,
        collection_id: activeCollection || undefined,
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

  const hasCover = !!space?.cover_url;

  return (
    <div className="om-space-page">
      {/* The Space wears its own header, not the shared PageHeader (ADR-020). */}
      <header className={`om-space-header${hasCover ? ' has-cover' : ''}`} style={{ ['--space-hue' as string]: space?.color || '#6366F1' }}>
        <div
          className="om-space-header-band"
          style={hasCover ? { backgroundImage: `url(${space?.cover_url})` } : { background: band(space?.color || '#6366F1') }}
        >
          {!hasCover && <div className="om-hero-noise" />}
          {space && (
            <button
              className="om-space-edit"
              onClick={() => { setEditingSpace(space); setSpaceModalOpen(true); }}
              title="Edit Space"
            >
              <Icon name="edit" size={14} />
            </button>
          )}
          <div className="om-space-cover-actions">
            <button className="om-space-cover-btn" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} title={hasCover ? 'Change cover' : 'Add cover'}>
              <Icon name="image" size={12} />
              <span>{coverBusy ? 'Uploading…' : hasCover ? 'Change cover' : 'Add cover'}</span>
            </button>
            {hasCover && (
              <button className="om-space-cover-btn" onClick={removeCover} disabled={coverBusy} title="Remove cover">
                <Icon name="trash" size={12} />
              </button>
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
      </header>

      {isLoading ? (
        <div className="om-empty">
          <div className="om-empty-mark"><Icon name="refresh" size={24} /></div>
          <p>Loading…</p>
        </div>
      ) : memos.length === 0 ? (
        <div className="om-empty">
          <div className="om-empty-mark"><Icon name="layers" size={24} /></div>
          <p>This Space is empty. Add a memo and it lands here, not in your main library.</p>
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
