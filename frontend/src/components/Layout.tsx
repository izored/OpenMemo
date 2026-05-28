import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
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
  const [blobsHidden, setBlobsHidden] = useState(false);
  const prevTheme = useRef(tweaks.theme);
  const mounted = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const blobTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smooth scroll on the main content pane. Lenis hijacks wheel/touch and
  // eases the scrollTop with rAF — same easing-driven feel as motion sites.
  useEffect(() => {
    const wrapper = mainRef.current;
    if (!wrapper) return;
    const lenis = new Lenis({
      wrapper,
      content: wrapper.firstElementChild as HTMLElement,
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  // Drive theme / accent / background CSS vars from persisted tweaks.
  useEffect(() => {
    applyTweaks(tweaks);
    if (!mounted.current) { mounted.current = true; return; }
    if (prevTheme.current !== tweaks.theme) {
      prevTheme.current = tweaks.theme;
      setOverlayTheme(tweaks.theme);
      setOverlayKey((k) => k + 1);
      setBlobsHidden(true);
      if (blobTimer.current) clearTimeout(blobTimer.current);
      blobTimer.current = setTimeout(() => setBlobsHidden(false), 12000);
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
    <div className={cn('om-app', sidebarCollapsed && 'sidebar-collapsed', blobsHidden && 'theme-transitioning')}>
      <div className="om-bg-veil" style={{ opacity: tweaks.bgFade ?? 0 }} aria-hidden />
      <Sidebar />

      <main className="om-main" key={location.pathname} ref={mainRef}>
        <div className="om-main-inner">
          <Outlet />
        </div>
      </main>

      <Onboarding />
      <SearchOverlay />
      <AddMemoPanel />
      <AppearancePanel />
      <FullscreenWriter />
      <AddCollectionModal />

      {/* Theme transition — sunset/sunrise radial bloom from the horizon.
          Sits BEHIND the memo grid (z=0, same as the bg blob layer) so the
          UI stays fully visible during the swap. Going dark: purple-tinted
          dusk rolls in from the bottom. Going light: warm dawn lifts from
          the top.
          No clip-path — the gradient itself is sized via the `--r` CSS
          variable. The outer alpha stop (`transparent 100%`) makes the
          leading edge softly fade INTO the background, no hard boundary.
          Two phases (sequential, 2× slower than v1): 0–6s tidal grow,
          0–12s opacity fade (full opacity for the first 6s, then fades). */}
      <AnimatePresence>
        {overlayKey > 0 && (
          <motion.div
            key={overlayKey}
            initial={{ '--r': '3%', opacity: 1 } as any}
            animate={{ '--r': '180%', opacity: [1, 1, 0] } as any}
            transition={{
              '--r': { duration: 6, ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number] },
              opacity: { duration: 12, times: [0, 0.5, 1], ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
            }}
            style={{
              position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
              background: overlayTheme === 'dark'
                ? 'radial-gradient(ellipse var(--r) var(--r) at 50% 0%, rgba(140, 70, 200, 0.95) 0%, rgba(60, 30, 110, 0.88) 40%, rgba(10, 8, 22, 0.72) 70%, rgba(6, 5, 14, 0.35) 88%, rgba(6, 5, 14, 0) 100%)'
                : 'radial-gradient(ellipse var(--r) var(--r) at 50% 100%, rgba(255, 200, 140, 0.95) 0%, rgba(255, 220, 180, 0.88) 40%, rgba(255, 245, 225, 0.72) 70%, rgba(255, 253, 248, 0.35) 88%, rgba(255, 253, 248, 0) 100%)',
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
