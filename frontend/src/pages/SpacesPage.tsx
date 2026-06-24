import { useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { spaceApi, memoApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Space } from '@/types';

function cover(color: string): string {
  const c = color || '#6366F1';
  return `linear-gradient(150deg, ${c} 0%, color-mix(in oklab, ${c} 55%, #14131c) 70%, color-mix(in oklab, ${c} 30%, #0c0b12) 100%)`;
}

function SpaceCard({ s, coverImg, onOpen, onEdit }: { s: Space; coverImg?: string; onOpen: () => void; onEdit: (e: React.MouseEvent) => void }) {
  return (
    <div className="om-coll-card" onClick={onOpen}>
      <span className="om-coll-stack om-coll-stack-2" style={{ background: s.color || '#6366F1' }} />
      <span className="om-coll-stack om-coll-stack-1" style={{ background: s.color || '#6366F1' }} />
      <div className="om-coll-face" style={{ ['--hue' as string]: s.color || '#6366F1' }}>
        <div className="om-coll-cover" style={{ background: cover(s.color || '#6366F1') }}>
          {coverImg && (
            <div className="om-coll-cover-img" style={{ backgroundImage: `url(${coverImg})` }} />
          )}
          <div className="om-hero-noise" />
          <span className="om-space-glyph" aria-hidden>{s.emoji || '🗂️'}</span>
          <span className="om-coll-edit visible" role="button" title="Edit Space" onClick={onEdit}>
            <Icon name="edit" size={13} />
          </span>
        </div>
        <div className="om-coll-body">
          <div className="om-coll-meta">
            <span className="mono">
              {(s.counts?.memos ?? 0)} Memo{s.counts?.memos === 1 ? '' : 's'}
              {' · '}
              {(s.counts?.collections ?? 0)} Coll{s.counts?.collections === 1 ? '' : 's'}
            </span>
          </div>
          <h3 className="om-coll-title">{s.name}</h3>
          <p className="om-coll-recent">{s.description || 'A separate place for a bigger project.'}</p>
        </div>
      </div>
    </div>
  );
}

export function SpacesPage() {
  const navigate = useNavigate();
  const { setActiveSpace, setSpaceModalOpen, setEditingSpace } = useAppStore();

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: ['spaces'],
    queryFn: spaceApi.list,
  });

  // Pull a few memos per Space so the card can show a thumbnail of what's
  // inside (mirrors the Collections page). Each Space is its own workspace.
  const previews = useQueries({
    queries: spaces.map((s) => ({
      queryKey: ['space-preview', s.id],
      queryFn: () => memoApi.list({ workspace_id: s.id, limit: 4 }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const open = (s: Space) => {
    setActiveSpace(s.id);
    navigate(`/space/${s.id}`);
  };
  const edit = (s: Space) => {
    setEditingSpace(s);
    setSpaceModalOpen(true);
  };
  const newSpace = () => {
    setEditingSpace(null);
    setSpaceModalOpen(true);
  };

  return (
    <div className="om-colls">
      <PageHeader
        eyebrow={`Spaces · ${spaces.length}`}
        title="Your Spaces"
        sub="A Space is a project with its own walls: its own memos and collections, kept out of the main library."
      />

      {isLoading ? (
        <div className="om-empty">
          <div className="om-empty-mark"><Icon name="refresh" size={24} /></div>
          <p>Loading Spaces…</p>
        </div>
      ) : (
        <div className="om-colls-grid">
          {spaces.map((s, i) => {
            const items = previews[i]?.data?.items || [];
            const coverImg =
              s.cover_url ||
              items.find((m: { thumbnail_path?: string }) => m.thumbnail_path)?.thumbnail_path;
            return (
              <SpaceCard
                key={s.id}
                s={s}
                coverImg={coverImg ?? undefined}
                onOpen={() => open(s)}
                onEdit={(e) => { e.stopPropagation(); edit(s); }}
              />
            );
          })}
          <button className="om-coll-card om-coll-new" onClick={newSpace}>
            <div className="om-coll-face new">
              <Icon name="plus" size={22} />
              <span>New Space</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
