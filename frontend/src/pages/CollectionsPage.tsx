import { useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { collectionApi, memoApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Collection } from '@/types';

function cover(color: string): string {
  const c = color || '#C9A876';
  return `linear-gradient(150deg, ${c} 0%, color-mix(in oklab, ${c} 55%, #1a1714) 70%, color-mix(in oklab, ${c} 30%, #100f0d) 100%)`;
}

export function CollectionsPage() {
  const navigate = useNavigate();
  const { setActiveCollection, setCollectionModalOpen, setEditingCollection } = useAppStore();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const previews = useQueries({
    queries: (collections as Collection[]).map((c) => ({
      queryKey: ['collection-preview', c.id],
      queryFn: () => memoApi.list({ collection_id: c.id, limit: 3 }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const open = (id: string) => {
    setActiveCollection(id);
    navigate('/');
  };
  const edit = (e: React.MouseEvent, c: Collection) => {
    e.stopPropagation();
    setEditingCollection(c);
    setCollectionModalOpen(true);
  };
  const newCollection = () => {
    setEditingCollection(null);
    setCollectionModalOpen(true);
  };

  return (
    <div className="om-colls">
      <div className="om-colls-head">
        <span className="om-greet-eyebrow mono">Collections · {collections.length}</span>
        <h1 className="om-greet-title">Your collections</h1>
        <p className="om-greet-sub">Folders, but with a memory. Drop a Memo onto one in the sidebar to file it.</p>
      </div>

      <div className="om-colls-grid">
        {(collections as Collection[]).map((c, i) => {
          const pv = previews[i]?.data;
          const total = pv?.total ?? 0;
          const items = pv?.items || [];
          const recent = items.slice(0, 2);
          // Cover = collection's own thumbnail if set, else latest memo's thumb.
          const coverImg =
            (c as Collection & { thumbnail_path?: string }).thumbnail_path ||
            items.find((m: { thumbnail_path?: string }) => m.thumbnail_path)?.thumbnail_path;
          return (
            <button key={c.id} className="om-coll-card" onClick={() => open(c.id)}>
              <span className="om-coll-stack om-coll-stack-2" style={{ background: c.color }} />
              <span className="om-coll-stack om-coll-stack-1" style={{ background: c.color }} />
              <div className="om-coll-face" style={{ ['--hue' as string]: c.color }}>
                <div className="om-coll-cover" style={{ background: cover(c.color) }}>
                  {coverImg && (
                    <div className="om-coll-cover-img" style={{ backgroundImage: `url(${coverImg})` }} />
                  )}
                  <div className="om-hero-noise" />
                  <span className="om-coll-edit" role="button" title="Edit collection" onClick={(e) => edit(e, c)}>
                    <Icon name="edit" size={13} />
                  </span>
                </div>
                <div className="om-coll-body">
                  <div className="om-coll-meta">
                    {c.pinned && <Icon name="pin" size={11} />}
                    <span className="mono">
                      {total} Memo{total === 1 ? '' : 's'}
                    </span>
                  </div>
                  <h3 className="om-coll-title">
                    {c.emoji ? `${c.emoji} ` : ''}
                    {c.name}
                  </h3>
                  <p className="om-coll-recent">
                    {recent.length
                      ? recent.map((m: { id: string; title: string }, j: number) => (
                          <span key={m.id}>
                            {j > 0 && ' · '}
                            {m.title.slice(0, 28)}
                          </span>
                        ))
                      : 'Empty collection'}
                  </p>
                </div>
              </div>
            </button>
          );
        })}

        <button className="om-coll-card om-coll-new" onClick={newCollection}>
          <div className="om-coll-face new">
            <Icon name="plus" size={22} />
            <span>New collection</span>
          </div>
        </button>
      </div>
    </div>
  );
}
