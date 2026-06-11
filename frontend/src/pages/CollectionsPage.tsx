import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { collectionApi, memoApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';

function cover(color: string): string {
  const c = color || '#C9A876';
  return `linear-gradient(150deg, ${c} 0%, color-mix(in oklab, ${c} 55%, #1a1714) 70%, color-mix(in oklab, ${c} 30%, #100f0d) 100%)`;
}

interface CardProps {
  c: Collection;
  total: number;
  recent: { id: string; title: string }[];
  coverImg?: string;
  editMode: boolean;
  onOpen: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onPin: (e: React.MouseEvent) => void;
}

function CollCard({ c, total, recent, coverImg, editMode, onOpen, onEdit, onPin }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: c.id,
    disabled: !editMode,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="om-coll-card"
      onClick={editMode ? onEdit : onOpen}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      <span className="om-coll-stack om-coll-stack-2" style={{ background: c.color }} />
      <span className="om-coll-stack om-coll-stack-1" style={{ background: c.color }} />
      <div className="om-coll-face" style={{ ['--hue' as string]: c.color }}>
        <div className="om-coll-cover" style={{ background: cover(c.color) }}>
          {coverImg && (
            <div className="om-coll-cover-img" style={{ backgroundImage: `url(${coverImg})` }} />
          )}
          <div className="om-hero-noise" />
          {editMode && (
            <span className="om-coll-edit visible" role="button" title="Edit collection" onClick={onEdit}>
              <Icon name="edit" size={13} />
            </span>
          )}
          <button
            className={cn('om-coll-pin', c.pinned && 'pinned')}
            onClick={(e) => { e.stopPropagation(); onPin(e); }}
            title={c.pinned ? 'Unpin collection' : 'Pin collection to sidebar'}
            aria-label={c.pinned ? 'Unpin' : 'Pin'}
          >
            <Icon name="pin" size={13} />
          </button>
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
              ? recent.map((m, j) => (
                  <span key={m.id}>
                    {j > 0 && ' · '}
                    {m.title.slice(0, 28)}
                  </span>
                ))
              : 'Empty collection'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function CollectionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setActiveCollection, setCollectionModalOpen, setEditingCollection } = useAppStore();
  const [editMode, setEditMode] = useState(false);

  const { data: serverCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });
  const [order, setOrder] = useState<Collection[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync server collections into local drag-order state
    setOrder(serverCollections as Collection[]);
  }, [serverCollections]);

  const previews = useQueries({
    queries: order.map((c) => ({
      queryKey: ['collection-preview', c.id],
      queryFn: () => memoApi.list({ collection_id: c.id, limit: 3 }),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const open = (id: string) => {
    setActiveCollection(id);
    navigate('/');
  };
  const edit = (c: Collection) => {
    setEditingCollection(c);
    setCollectionModalOpen(true);
  };
  const newCollection = () => {
    setEditingCollection(null);
    setCollectionModalOpen(true);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = order.findIndex((c) => c.id === active.id);
    const newI = order.findIndex((c) => c.id === over.id);
    if (oldI === -1 || newI === -1) return;
    const next = arrayMove(order, oldI, newI);
    setOrder(next);
    Promise.all(next.map((c, i) => collectionApi.update(c.id, { sort_order: i })))
      .then(() => queryClient.invalidateQueries({ queryKey: ['collections'] }))
      .catch((err) => console.error('Reorder failed:', err));
  };

  return (
    <div className="om-colls">
      <PageHeader
        eyebrow={`Collections · ${order.length}`}
        title="Your collections"
        sub="Folders, but with a memory. Drop a Memo onto one in the sidebar to file it."
      >
        <button
          className={cn('om-btn-secondary', editMode && 'active')}
          onClick={() => setEditMode((v) => !v)}
          title="Edit collections"
        >
          <Icon name={editMode ? 'check' : 'edit'} size={13} />
          {editMode ? 'Done' : 'Edit'}
        </button>
      </PageHeader>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="om-colls-grid">
            {order.map((c, i) => {
              const pv = previews[i]?.data;
              const items = pv?.items || [];
              const coverImg =
                (c as Collection & { thumbnail_path?: string }).thumbnail_path ||
                items.find((m: { thumbnail_path?: string }) => m.thumbnail_path)?.thumbnail_path;
              return (
                <CollCard
                  key={c.id}
                  c={c}
                  total={pv?.total ?? 0}
                  recent={items.slice(0, 2)}
                  coverImg={coverImg}
                  editMode={editMode}
                  onOpen={() => open(c.id)}
                  onEdit={(e) => {
                    e.stopPropagation();
                    edit(c);
                  }}
                  onPin={async () => {
                    try {
                      await collectionApi.update(c.id, { pinned: !c.pinned });
                      queryClient.invalidateQueries({ queryKey: ['collections'] });
                    } catch { /* ignore */ }
                  }}
                />
              );
            })}

            {!editMode && (
              <button className="om-coll-card om-coll-new" onClick={newCollection}>
                <div className="om-coll-face new">
                  <Icon name="plus" size={22} />
                  <span>New collection</span>
                </div>
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
