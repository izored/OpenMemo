import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { isPlainClick } from '@/lib/nav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { Icon } from './Icon';
import { SidebarPlayer } from './SidebarPlayer';
import { collectionApi, memoApi, systemApi, settingsApi, spaceApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import { modKey } from '@/lib/install';
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
  // Dimmed, not removed: a collection kept out of the dashboard feed is still
  // the fastest way to open it (OPNMMO-0053).
  const dashHidden = !!col.hidden_from_dashboard;
  return (
    <button
      ref={setNodeRef}
      className={cn('om-coll', pinned && 'pinned', active && 'active', isOver && 'drop-over', dashHidden && 'dash-hidden')}
      onClick={onSelect}
      title={dashHidden ? `${col.name} — hidden from the dashboard feed` : undefined}
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
  const queryClient = useQueryClient();

  // The "openMemo" mark is the way home, and — when you are already home — the
  // way to pull the feed fresh. Collapse/expand lives on the chevron beside it
  // (and on the hamburger the mark becomes once the rail is collapsed), so the
  // mark itself never has two jobs at once.
  const onBrandClick = () => {
    if (sidebarCollapsed && !isMobile) {
      toggleSidebarCollapsed();
      return;
    }
    const atDashboard = location.pathname === '/' && !activeCollection && !activeSpace;
    setActiveCollection(null);
    setActiveSpace(null);
    if (atDashboard) {
      // Same route, so navigate() would be a no-op. Drop the cached pages
      // instead: the infinite feed, the collection list and the counts all
      // refetch and the grid repaints from the top.
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } else {
      navigate('/');
    }
    if (isMobile) setSidebarOpen(false);
  };

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
  // Library collections collapse is purely manual now (the chevron). Opening a
  // Space no longer auto-collapses them — both stay visible.
  const [libCollapsed, setLibCollapsed] = React.useState(false);
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

  // Per-Space hidden reveal (ADR-020): the same quiet dwell gesture as the
  // library, but scoped to the open Space. Dwelling on the open Space's "New
  // collection" row fades in a "hidden" link that opens /space/:id/hidden. One
  // global passcode still gates it — Spaces don't add a second secret.
  const [spaceHiddenRevealed, setSpaceHiddenRevealed] = React.useState(false);
  const spaceRevealTimer = React.useRef<number | null>(null);
  const cancelSpaceReveal = React.useCallback(() => {
    if (spaceRevealTimer.current !== null) {
      window.clearTimeout(spaceRevealTimer.current);
      spaceRevealTimer.current = null;
    }
  }, []);
  const startSpaceReveal = () => {
    if (spaceHiddenRevealed) return;
    cancelSpaceReveal();
    spaceRevealTimer.current = window.setTimeout(() => setSpaceHiddenRevealed(true), 1500);
  };
  const hideSpaceReveal = () => {
    cancelSpaceReveal();
    setSpaceHiddenRevealed(false);
  };
  React.useEffect(() => cancelSpaceReveal, [cancelSpaceReveal]);
  // Leaving a Space drops any revealed Space-hidden affordance.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: leaving a Space resets its dwell-revealed hidden link
    if (!activeSpace) setSpaceHiddenRevealed(false);
  }, [activeSpace]);

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
    { id: 'spaces', label: 'Spaces', icon: 'grid', path: '/spaces' },
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
    // Clicking Ask Memo always lands on a fresh new chat, even from inside a
    // thread. A same-path navigate() is a no-op, so pass a changing state that
    // the Ask page watches to reset (see AskMemoPage location effect).
    navigate(path, path === '/ask' ? { state: { newChat: Date.now() } } : undefined);
  };
  const selectCollection = (id: string) => {
    setActiveSpace(null);
    // The route carries the collection now, so a refresh stays put. Dashboard
    // syncs the store slice from the param.
    navigate(`/collection/${id}`);
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
    navigate(`/space/${spaceId}/collection/${collId}`);
    if (isMobile) setSidebarOpen(false);
  };
  // Open the open Space's own hidden section (ADR-020). Stays inside the Space.
  const openSpaceHidden = (spaceId: string) => {
    setActiveSpace(spaceId);
    setActiveCollection(null);
    hideSpaceReveal();
    navigate(`/space/${spaceId}/hidden`);
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
          onClick={onBrandClick}
          title={
            sidebarCollapsed && !isMobile
              ? 'Expand sidebar'
              : location.pathname === '/' && !activeCollection && !activeSpace
                ? 'Refresh the dashboard'
                : 'Go to the dashboard'
          }
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
            <span className="om-kbd mono">{modKey('K')}</span>
          </>
        )}
      </button>

      <nav className="om-sidebar-nav">
        {navItems.map((n) => (
          <button
            key={n.id}
            data-tour={`nav-${n.id}`}
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

      {/* ONE scroll region holds every variable section — Spaces, Pinned,
          Collections. Head/search/nav above and player/foot below stay fixed, so
          expanding a Space or collapsing a list never resizes the player. Nothing
          auto-hides: sections only open/close when the user toggles them. */}
      <div className="om-sidebar-scroll" data-lenis-prevent>
        {!sidebarCollapsed && (
          <>
            {/* Spaces (ADR-020) — walled project areas. Tap one to open its
                collections inline; the library sections stay put below. */}
            <div className="om-sidebar-section om-spaces-section">
              <div className="om-section-head">
                <span className="om-section-label mono">Spaces</span>
                <div className="om-collections-head-actions">
                  <button className="om-icon-btn sm" title="View all Spaces" onClick={() => goRoute('/spaces')}>
                    <Icon name="grid" size={11} />
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
                        <div className="om-space-collections" onMouseLeave={hideSpaceReveal}>
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
                            onMouseEnter={startSpaceReveal}
                            onMouseLeave={cancelSpaceReveal}
                            title={`New collection in ${s.name}`}
                          >
                            <Icon name="plus" size={11} />
                            <span>New collection</span>
                          </button>
                          {/* Quiet dwell-to-reveal hidden entry for THIS Space. */}
                          {spaceHiddenRevealed && (
                            <button
                              className="om-space-add-coll om-space-hidden-reveal mono"
                              onClick={() => openSpaceHidden(s.id)}
                              title={`Open the hidden section in ${s.name}`}
                            >
                              <Icon name="eye" size={11} />
                              <span>hidden</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pinned — always visible, even inside a Space. */}
            {(pinned.length > 0 || pinnedMemos.length > 0) && (
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
                    <Link
                      key={`memo-${m.id}`}
                      to={`/memo/${m.id}`}
                      className="om-coll pinned"
                      // Clearing the collection filter belongs to THIS tab. On a
                      // ctrl+click the memo opens elsewhere and here should not move.
                      onClick={(e) => { if (isPlainClick(e)) setActiveCollection(null); }}
                      title={m.title}
                      draggable={false}
                    >
                      <span className="om-coll-dot" style={{ background: 'var(--accent)' }} />
                      <span className="om-coll-name">{m.title}</span>
                      <Icon name="pin" size={10} className="om-coll-count" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Collections — header + list, manual collapse only (the chevron). */}
            <div className="om-sidebar-section">
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
                    <button className="om-hidden-reveal mono" onClick={() => goRoute('/hidden')} title="Open the hidden section">
                      hidden
                    </button>
                  )}
                  {isMobile ? (
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
                      onClick={() => { setEditingCollection(null); setCollectionModalOpen(true); }}
                    >
                      <Icon name="plus" size={11} />
                    </button>
                  )}
                </div>
              </div>
              {!libCollapsed && (
                <div className="om-collection-list">
                  {others.length === 0 && !isMobile && (
                    <button
                      className="om-space-empty-cta"
                      onClick={() => { setEditingCollection(null); setCollectionModalOpen(true); }}
                    >
                      <Icon name="plus" size={11} />
                      <span>Create your first collection</span>
                    </button>
                  )}
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
          </>
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
