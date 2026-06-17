import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { Icon } from './Icon';
import { SidebarPlayer } from './SidebarPlayer';
import { collectionApi, memoApi, systemApi, settingsApi, spaceApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import type { Collection, Space } from '@/types';
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
      className={cn('om-coll', pinned && 'pinned', active && 'active', isOver && 'drop-over')}
      onClick={onSelect}
    >
      <span
        className="om-coll-dot"
        style={{ background: pinned ? 'var(--text)' : col.color || 'var(--text-4)' }}
      />
      <span className="om-coll-name">{col.name}</span>
      <span
        className="om-coll-emoji"
        onClick={onEdit}
        title="Edit collection"
        role="button"
      >
        {col.emoji || '·'}
      </span>
    </button>
  );
}

type ThemeValue = 'light' | 'dark';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    activeCollection,
    setActiveCollection,
    activeSpace,
    setActiveSpace,
    setSpaceModalOpen,
    setEditingSpace,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    setSidebarOpen,
    setCollectionModalOpen,
    setEditingCollection,
    setSearchOpen,
    tweaks,
    setTweak,
  } = useAppStore();
  const isMobile = useIsMobile();

  // Two explicit themes only — the old "System" option is gone (dark mode is
  // manually toggled, never auto-applied; see CLAUDE.md).
  const theme: ThemeValue = tweaks.theme === 'dark' ? 'dark' : 'light';
  const setTheme = (t: ThemeValue) => setTweak({ theme: t });

  // Hidden-section entry point (OPNMMO-0016): dwell on the "+" (new
  // collection) for 1.5s and a "hidden" link fades in between the Collections
  // label and the "+". It stays while the pointer remains on the head row.
  const [hiddenRevealed, setHiddenRevealed] = React.useState(false);
  // Mobile drawer: collections collapse to the first 3 behind a chevron, and
  // creating a collection is desktop-only — so the header "+" becomes the
  // expand/collapse toggle on mobile.
  const [collExpanded, setCollExpanded] = React.useState(false);
  // Library Collections collapse (not hide) when a Space opens, so the Space's
  // own collections get the room — but the header stays, with a chevron to
  // expand the library list back without leaving the Space.
  const [libCollapsed, setLibCollapsed] = React.useState(false);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: opening/leaving a Space drives the library-collections collapse default
    setLibCollapsed(!!activeSpace);
  }, [activeSpace]);
  const revealTimer = React.useRef<number | null>(null);
  const cancelReveal = React.useCallback(() => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);
  const startReveal = () => {
    if (hiddenRevealed) return;
    cancelReveal();
    revealTimer.current = window.setTimeout(() => setHiddenRevealed(true), 1500);
  };
  const hideReveal = () => {
    cancelReveal();
    setHiddenRevealed(false);
  };
  React.useEffect(() => cancelReveal, [cancelReveal]);

  // Expose sidebar width as a CSS var so fixed overlays (lightbox) can clear it.
  React.useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', sidebarCollapsed ? '76px' : '260px');
  }, [sidebarCollapsed]);

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionApi.list(),
  });
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: spaceApi.list,
  });
  // The open Space's own collections (accordion dropdown). Only fetched while a
  // Space is active.
  const { data: spaceCollections = [] } = useQuery({
    queryKey: ['collections', activeSpace],
    queryFn: () => collectionApi.list(activeSpace || undefined),
    enabled: !!activeSpace,
  });
  const { data: pinnedMemos = [] } = useQuery({
    queryKey: ['memos', 'pinned'],
    queryFn: () => memoApi.listPinned(),
  });
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    // No storage flag — the sidebar only needs total_memos. Passing systemApi.stats
    // directly would hand React Query's context object in as includeStorage (truthy)
    // and trigger the expensive filesystem walk on every page.
    queryFn: () => systemApi.stats(),
  });
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const navItems = [
    { id: 'home', label: 'All Memos', icon: 'home', path: '/' },
    { id: 'collections', label: 'Collections', icon: 'layers', path: '/collections' },
    { id: 'music', label: 'Music', icon: 'music', path: '/music' },
    { id: 'ask', label: 'Ask Memo', icon: 'sparkles', path: '/ask' },
  ];

  const pinned = collections.filter((c: Collection) => c.pinned);
  const others = collections.filter((c: Collection) => !c.pinned);
  // Mobile drawer shows the first 3 collections until the chevron expands them.
  const visibleOthers = isMobile && !collExpanded ? others.slice(0, 3) : others;

  // Leaving for a library route exits any open Space (ADR-020 accordion).
  const goRoute = (path: string) => {
    setActiveCollection(null);
    setActiveSpace(null);
    navigate(path);
  };
  const selectCollection = (id: string) => {
    setActiveCollection(id);
    setActiveSpace(null);
    navigate('/');
  };
  // Tapping a Space always opens it (its collections drop down, the library
  // sections retract). It never closes back to the dashboard — leaving a Space
  // is the header's "openMemo" back button or a library nav item. Clicking the
  // open Space again just lands on its catch-all home (clears any collection).
  const openSpace = (id: string) => {
    setActiveSpace(id);
    setActiveCollection(null);
    navigate(`/space/${id}`);
    if (isMobile) setSidebarOpen(false);
  };
  const selectSpaceCollection = (spaceId: string, collId: string) => {
    setActiveSpace(spaceId);
    setActiveCollection(collId);
    navigate(`/space/${spaceId}`);
    if (isMobile) setSidebarOpen(false);
  };
  const editCollection = (e: React.MouseEvent, col: Collection) => {
    e.stopPropagation();
    setEditingCollection(col);
    setCollectionModalOpen(true);
  };

  const themeOptions: { value: ThemeValue; icon: string; label: string }[] = [
    { value: 'light', icon: 'sun', label: 'Light' },
    { value: 'dark', icon: 'moon', label: 'Dark' },
  ];

  return (
    <motion.aside
      className={cn('om-sidebar', sidebarCollapsed && 'collapsed')}
      animate={{ width: sidebarCollapsed ? 76 : 260 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      <div className="om-sidebar-head">
        <button
          className="om-brand"
          onClick={() => {
            // On mobile the drawer header logo goes home (ADR-009 #3); on
            // desktop it keeps the collapse/expand toggle.
            if (isMobile) {
              navigate('/');
              setSidebarOpen(false);
            } else {
              toggleSidebarCollapsed();
            }
          }}
          title={isMobile ? 'Go home' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed && !isMobile
            ? <Icon name="menu" size={18} style={{ color: 'var(--text-3)' }} />
            : <span className="om-brand-name">openMemo</span>
          }
        </button>
        {/* Desktop: collapse chevron. Hidden on mobile via CSS. */}
        {!sidebarCollapsed && (
          <button className="om-icon-btn om-collapse-chevron" onClick={toggleSidebarCollapsed} title="Collapse">
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
        {/* Mobile: prominent close button for the full-screen drawer. Hidden on
            desktop via CSS. */}
        <button
          className="om-sidebar-mobile-close"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
          title="Close"
        >
          <Icon name="x" size={20} />
        </button>
      </div>

      {/* Fixed controls — search + nav never scroll. */}
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
              (location.pathname === n.path ||
                (n.path !== '/' && location.pathname.startsWith(n.path + '/'))) &&
                !activeCollection && !activeSpace && 'active'
            )}
            title={n.label}
            onClick={() => goRoute(n.path)}
          >
            <Icon name={n.icon} size={15} />
            {!sidebarCollapsed && <span>{n.label}</span>}
          </button>
        ))}
      </nav>

      {/* Spaces (ADR-020) — separate, walled project areas above collections.
          Tapping one opens it as an accordion: its collections drop down here
          and the library's Pinned + Collections sections retract below. */}
      {!sidebarCollapsed && (
        <div className="om-sidebar-section om-spaces-section">
          <div className="om-section-head">
            <span className="om-section-label mono">Spaces</span>
            <div className="om-collections-head-actions">
              <button
                className="om-icon-btn sm"
                title="View all Spaces"
                onClick={() => goRoute('/spaces')}
              >
                <Icon name="layers" size={11} />
              </button>
              <button
                className="om-icon-btn sm"
                title="New Space"
                onClick={() => { setEditingSpace(null); setSpaceModalOpen(true); }}
              >
                <Icon name="plus" size={11} />
              </button>
            </div>
          </div>
          <div className="om-collection-list">
            {(spaces as Space[]).length === 0 && (
              <button className="om-space-empty-cta" onClick={() => { setEditingSpace(null); setSpaceModalOpen(true); }}>
                <Icon name="plus" size={11} />
                <span>Create your first Space</span>
              </button>
            )}
            {(spaces as Space[]).map((s) => {
              const open = activeSpace === s.id;
              return (
                <div key={s.id} className={cn('om-space-group', open && 'open')}>
                  <button
                    className={cn('om-coll om-space-row', open && 'active')}
                    onClick={() => openSpace(s.id)}
                    title={s.name}
                  >
                    <span className="om-space-row-emoji">{s.emoji || '🗂️'}</span>
                    <span className="om-coll-name">{s.name}</span>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} className="om-coll-count" />
                  </button>
                  {open && (
                    <div className="om-space-collections">
                      {spaceCollections.length === 0 && (
                        <span className="om-space-empty mono">No collections yet</span>
                      )}
                      {(spaceCollections as Collection[]).map((c) => (
                        <button
                          key={c.id}
                          className={cn('om-coll om-space-coll', activeCollection === c.id && 'active')}
                          onClick={() => selectSpaceCollection(s.id, c.id)}
                        >
                          <span className="om-coll-dot" style={{ background: c.color || 'var(--text-4)' }} />
                          <span className="om-coll-name">{c.name}</span>
                          <span className="om-coll-emoji">{c.emoji || '·'}</span>
                        </button>
                      ))}
                      <button
                        className="om-space-add-coll"
                        onClick={() => { setEditingCollection(null); setCollectionModalOpen(true); }}
                        title={`New collection in ${s.name}`}
                      >
                        <Icon name="plus" size={11} />
                        <span>New collection</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pinned stays fixed above the scroll zone. Hidden while a Space is open
          (the Space owns the rail then). */}
      {!sidebarCollapsed && !activeSpace && (pinned.length > 0 || pinnedMemos.length > 0) && (
        <div className="om-sidebar-section">
          <div className="om-section-head">
            <span className="om-section-label mono">Pinned</span>
            <Icon name="pin" size={10} className="om-section-icon" />
          </div>
          <div className="om-collection-list">
            {pinned.map((c: Collection) => (
              <CollectionRow
                key={`col-${c.id}`}
                col={c}
                pinned
                active={activeCollection === c.id}
                onSelect={() => selectCollection(c.id)}
                onEdit={(e) => editCollection(e, c)}
              />
            ))}
            {pinnedMemos.map((m) => (
              <button
                key={`memo-${m.id}`}
                className="om-coll pinned"
                onClick={() => {
                  setActiveCollection(null);
                  navigate(`/memo/${m.id}`);
                }}
                title={m.title}
              >
                <span className="om-coll-dot" style={{ background: 'var(--accent)' }} />
                <span className="om-coll-name">{m.title}</span>
                <Icon name="pin" size={10} className="om-coll-count" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collections header — fixed; only its LIST (below) scrolls. When a Space
          is open the list collapses (not hidden): the header stays with a
          chevron to expand the library collections back in place. */}
      {!sidebarCollapsed && (
        <div className="om-section-head om-collections-head" onMouseLeave={hideReveal}>
          <button
            className="om-section-label mono om-coll-collapse-toggle"
            onClick={() => setLibCollapsed((v) => !v)}
            title={libCollapsed ? 'Show collections' : 'Collapse collections'}
            aria-expanded={!libCollapsed}
          >
            <Icon name={libCollapsed ? 'chevronRight' : 'chevronDown'} size={11} />
            <span>Collections</span>
          </button>
          <div className="om-collections-head-actions">
            {hiddenRevealed && (
              <button
                className="om-hidden-reveal mono"
                onClick={() => goRoute('/hidden')}
                title="Open the hidden section"
              >
                hidden
              </button>
            )}
            {isMobile ? (
              // Mobile: creating a collection is desktop-only; the header control
              // is a chevron that expands/collapses the (3-by-default) list.
              others.length > 3 && (
                <button
                  className={cn('om-icon-btn sm om-coll-toggle', collExpanded && 'is-open')}
                  onClick={() => setCollExpanded((v) => !v)}
                  title={collExpanded ? 'Show fewer' : `Show all ${others.length}`}
                  aria-expanded={collExpanded}
                  aria-label={collExpanded ? 'Show fewer collections' : 'Show all collections'}
                >
                  <Icon name="chevronDown" size={14} />
                </button>
              )
            ) : (
              <button
                className="om-icon-btn sm"
                title="New collection"
                onMouseEnter={startReveal}
                onMouseLeave={cancelReveal}
                onClick={() => {
                  setEditingCollection(null);
                  setCollectionModalOpen(true);
                }}
              >
                <Icon name="plus" size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ONLY the collections list scrolls. Always present (even collapsed) so it
          owns the slack and keeps the player + foot pinned to the bottom. */}
      <div className="om-sidebar-scroll" data-lenis-prevent>
        {!sidebarCollapsed && !libCollapsed && (
          <div className="om-collection-list">
            {visibleOthers.map((c: Collection) => (
              <CollectionRow
                key={c.id}
                col={c}
                pinned={false}
                active={activeCollection === c.id}
                onSelect={() => selectCollection(c.id)}
                onEdit={(e) => editCollection(e, c)}
              />
            ))}
            {isMobile && !collExpanded && others.length > 3 && (
              <button className="om-coll-more mono" onClick={() => setCollExpanded(true)}>
                Show {others.length - 3} more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom zone — player + foot, pinned below the scrollable body (no margin
          hacks; the body owns the flexible space). */}
      <SidebarPlayer />

      <div className="om-sidebar-foot">
        {/* Theme selector — Light / Dark (System removed on purpose).
            Collapsed sidebar AND mobile drawer: one compact toggle that flips
            to the other theme, so the whole foot fits on a single row. */}
        {sidebarCollapsed || isMobile ? (
          <div className="om-theme-row">
            <button
              className="om-theme-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle theme"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
          </div>
        ) : (
          <div className="om-theme-row">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                className={cn('om-theme-btn', theme === opt.value && 'active')}
                onClick={() => setTheme(opt.value)}
                title={opt.label}
              >
                <Icon name={opt.icon} size={15} />
              </button>
            ))}
          </div>
        )}

        <button
          className="om-foot-btn"
          onClick={() => location.pathname === '/settings' ? goRoute('/') : goRoute('/settings')}
          title={location.pathname === '/settings' ? 'Go home' : 'Settings'}
        >
          <div
            className="om-avatar"
            style={appSettings?.avatar_data_url ? {
              backgroundImage: `url(${appSettings.avatar_data_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              color: 'transparent',
            } : undefined}
          >
            {(appSettings?.display_name || 'You').slice(0, 2).toUpperCase()}
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="om-foot-info">
                <span className="om-foot-name">{appSettings?.display_name || 'openMemo'}</span>
                <span className="om-foot-meta mono">
                  {stats ? `${stats.total_memos.toLocaleString()} Memos` : 'openMemo'}
                </span>
              </div>
              <Icon name="settings" size={18} />
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
