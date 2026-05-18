import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { Icon } from './Icon';
import { collectionApi, systemApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { Collection } from '@/types';
import { cn } from '@/lib/utils';

function CollectionRow({
  col,
  pinned,
  active,
  onSelect,
  onEdit,
}: {
  col: Collection;
  pinned: boolean;
  active: boolean;
  onSelect: () => void;
  onEdit: (e: React.MouseEvent) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `col-${col.id}` });
  return (
    <button
      ref={setNodeRef}
      className={cn('om-coll', pinned && 'pinned', active && 'active')}
      style={isOver ? { boxShadow: 'inset 2px 0 0 var(--accent)', background: 'var(--accent-soft)' } : undefined}
      onClick={onSelect}
    >
      <span
        className="om-coll-dot"
        style={{ background: pinned ? 'var(--text)' : col.color || 'var(--text-4)' }}
      />
      <span className="om-coll-name">{col.name}</span>
      <span
        className="om-coll-count mono"
        onClick={onEdit}
        title="Edit collection"
        role="button"
      >
        {col.emoji || '·'}
      </span>
    </button>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeCollection,
    setActiveCollection,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    setCollectionModalOpen,
    setEditingCollection,
    setSearchOpen,
  } = useAppStore();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: systemApi.stats,
  });

  const navItems = [
    { id: 'home', label: 'All memos', icon: 'home', path: '/' },
    { id: 'collections', label: 'Collections', icon: 'layers', path: '/collections' },
    { id: 'ask', label: 'Ask memo', icon: 'sparkles', path: '/ask' },
  ];

  const pinned = collections.filter((c: Collection) => c.pinned);
  const others = collections.filter((c: Collection) => !c.pinned);

  const goRoute = (path: string) => {
    setActiveCollection(null);
    navigate(path);
  };
  const selectCollection = (id: string) => {
    setActiveCollection(id);
    navigate('/');
  };
  const editCollection = (e: React.MouseEvent, col: Collection) => {
    e.stopPropagation();
    setEditingCollection(col);
    setCollectionModalOpen(true);
  };

  return (
    <aside className={cn('om-sidebar', sidebarCollapsed && 'collapsed')}>
      <div className="om-sidebar-head">
        <button
          className="om-brand"
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="om-avatar" style={{ width: 26, height: 26, borderRadius: 8, fontSize: 11 }}>
            O
          </span>
          {!sidebarCollapsed && <span className="om-brand-name">OpenMemo</span>}
        </button>
        {!sidebarCollapsed && (
          <button className="om-icon-btn" onClick={toggleSidebarCollapsed} title="Collapse">
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
      </div>

      <button className="om-sidebar-search" onClick={() => setSearchOpen(true)} title="Search">
        <Icon name="search" size={13} />
        {!sidebarCollapsed && (
          <>
            <span>Search</span>
            <span className="om-kbd mono">⌘K</span>
          </>
        )}
      </button>

      <nav className="om-sidebar-nav">
        {navItems.map((n) => (
          <button
            key={n.id}
            className={cn(
              'om-nav-item',
              location.pathname === n.path && !activeCollection && 'active'
            )}
            title={n.label}
            onClick={() => goRoute(n.path)}
          >
            <Icon name={n.icon} size={15} />
            {!sidebarCollapsed && <span>{n.label}</span>}
          </button>
        ))}
      </nav>

      {!sidebarCollapsed && (
        <>
          {pinned.length > 0 && (
            <div className="om-sidebar-section">
              <div className="om-section-head">
                <span className="om-section-label mono">Pinned</span>
                <Icon name="pin" size={10} className="om-section-icon" />
              </div>
              <div className="om-collection-list">
                {pinned.map((c: Collection) => (
                  <CollectionRow
                    key={c.id}
                    col={c}
                    pinned
                    active={activeCollection === c.id}
                    onSelect={() => selectCollection(c.id)}
                    onEdit={(e) => editCollection(e, c)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="om-sidebar-section">
            <div className="om-section-head">
              <span className="om-section-label mono">Collections</span>
              <button
                className="om-icon-btn sm"
                title="New collection"
                onClick={() => {
                  setEditingCollection(null);
                  setCollectionModalOpen(true);
                }}
              >
                <Icon name="plus" size={11} />
              </button>
            </div>
            <div className="om-collection-list">
              {others.map((c: Collection) => (
                <CollectionRow
                  key={c.id}
                  col={c}
                  pinned={false}
                  active={activeCollection === c.id}
                  onSelect={() => selectCollection(c.id)}
                  onEdit={(e) => editCollection(e, c)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="om-sidebar-foot">
        <button
          className="om-foot-btn"
          onClick={() => goRoute('/settings')}
          title="Settings"
        >
          <div className="om-avatar">RI</div>
          {!sidebarCollapsed && (
            <>
              <div className="om-foot-info">
                <span className="om-foot-name">Reda Izo</span>
                <span className="om-foot-meta mono">
                  {stats ? `${stats.total_memos.toLocaleString()} memos` : 'OpenMemo'}
                </span>
              </div>
              <Icon name="settings" size={18} />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
