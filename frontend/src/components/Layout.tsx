import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AddMemoPanel } from './AddMemoPanel';
import { AppearancePanel } from './AppearancePanel';
import { FullscreenWriter } from './FullscreenWriter';
import { SearchOverlay } from './SearchOverlay';
import { AddCollectionModal } from './AddCollectionModal';
import { Icon } from './Icon';
import { useAppStore } from '@/stores/appStore';
import { applyTweaks } from '@/lib/appearance';
import { cn } from '@/lib/utils';

export function Layout() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const tweaks = useAppStore((s) => s.tweaks);
  const addPanelOpen = useAppStore((s) => s.addPanelOpen);
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const location = useLocation();

  // Drive theme / accent / background CSS vars from persisted tweaks.
  useEffect(() => {
    applyTweaks(tweaks);
  }, [tweaks]);

  // Global shortcuts: ⌘K search, N new memo (when not typing).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (!typing && e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
        setAddPanelOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setSearchOpen, setAddPanelOpen]);

  return (
    <div className={cn('om-app', sidebarCollapsed && 'sidebar-collapsed')}>
      <div className="om-bg-veil" style={{ opacity: tweaks.bgFade ?? 0 }} aria-hidden />
      <Sidebar />

      <main className="om-main" key={location.pathname}>
        <Outlet />
      </main>

      <SearchOverlay />
      <AddMemoPanel />
      <AppearancePanel />
      <FullscreenWriter />
      <AddCollectionModal />

      <button
        className={cn('om-fab', addPanelOpen && 'open')}
        onClick={() => setAddPanelOpen(!addPanelOpen)}
        title={addPanelOpen ? 'Close' : 'New memo · N'}
        aria-label="New memo"
      >
        <span className="om-fab-icon">
          <Icon name={addPanelOpen ? 'x' : 'plus'} size={18} />
        </span>
      </button>
    </div>
  );
}
