import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { AddMemoPanel } from './AddMemoPanel';
import { AppearancePanel } from './AppearancePanel';
import { FullscreenWriter } from './FullscreenWriter';
import { SearchOverlay } from './SearchOverlay';
import { Onboarding } from './Onboarding';
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

  const [overlayKey, setOverlayKey] = useState(0);
  const [overlayTheme, setOverlayTheme] = useState(tweaks.theme);
  const prevTheme = useRef(tweaks.theme);
  const mounted = useRef(false);

  // Drive theme / accent / background CSS vars from persisted tweaks.
  useEffect(() => {
    applyTweaks(tweaks);
    if (!mounted.current) { mounted.current = true; return; }
    if (prevTheme.current !== tweaks.theme) {
      prevTheme.current = tweaks.theme;
      setOverlayTheme(tweaks.theme);
      setOverlayKey((k) => k + 1);
    }
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

      <Onboarding />
      <SearchOverlay />
      <AddMemoPanel />
      <AppearancePanel />
      <FullscreenWriter />
      <AddCollectionModal />

      <AnimatePresence>
        {overlayKey > 0 && (
          <motion.div
            key={overlayKey}
            initial={{ opacity: 0.75 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 2.55, ease: 'easeOut' }}
            style={{
              position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
              background: overlayTheme === 'dark'
                ? 'radial-gradient(circle at 50% 45%, rgba(6,5,14,0.9) 0%, rgba(6,5,14,0.5) 100%)'
                : 'radial-gradient(circle at 50% 45%, rgba(255,253,248,0.95) 0%, rgba(255,253,248,0.4) 100%)',
            }}
          />
        )}
      </AnimatePresence>

      <button
        className={cn('om-fab', addPanelOpen && 'open')}
        onClick={() => setAddPanelOpen(!addPanelOpen)}
        title={addPanelOpen ? 'Close' : 'New Memo · N'}
        aria-label="New Memo"
      >
        <span className="om-fab-icon">
          <Icon name={addPanelOpen ? 'x' : 'plus'} size={18} />
        </span>
      </button>
    </div>
  );
}
