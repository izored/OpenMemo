import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import { DndBusContext, type GridDragHandlers } from '@/lib/dndBus';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { Sidebar } from './Sidebar';
import { MobileTopBar } from './MobileTopBar';
import { AddMemoPanel } from './AddMemoPanel';
import { FileDropLayer } from './FileDropLayer';
import { MusicAddModal } from './MusicAddModal';
import { AppearancePanel } from './AppearancePanel';
import { CloudBackground } from './CloudBackground';
import { FullscreenWriter } from './FullscreenWriter';
import { SearchOverlay } from './SearchOverlay';
import { Onboarding } from './Onboarding';
import { AddCollectionModal } from './AddCollectionModal';
import { AddSpaceModal } from './AddSpaceModal';
import { Lightbox } from './Lightbox';
import { OfflineBar } from './OfflineBar';
import { GuideHost } from './GuideHost';
import { ThumbnailEditHost } from './ThumbnailEditHost';
import { PlaylistCoverHost } from './PlaylistCoverHost';
import { DeleteToast } from './DeleteToast';
import { NoticeToast } from './NoticeToast';
import { AudioPlayerProvider } from '@/lib/audioPlayer';
import { settingsApi } from '@/lib/api';
import { Icon } from './Icon';
import { useTransitionConfig, type TransitionConfig } from '@/lib/transitionConfig';
import { useAppStore } from '@/stores/appStore';
import { useIsMobile } from '@/lib/useBreakpoint';
import { applyTweaks } from '@/lib/appearance';
import { cn } from '@/lib/utils';

// Dev panel is gitignored (frontend/src/dev/). Load it optionally — import.meta.glob
// returns {} when the folder is absent, so production / fresh clones still build.
// The folder can still be present in a Docker build context (gitignore ≠ dockerignore),
// so the actual render is also gated on import.meta.env.DEV below — it never ships.
const devPanelModules = import.meta.env.DEV
  ? (import.meta.glob('../dev/DevPanel.tsx', { eager: true }) as Record<
      string,
      { DevPanel: (p: { txConfig: TransitionConfig; setTxConfig: (patch: Partial<TransitionConfig>) => void; resetTxConfig: () => void; onTestTransition: () => void }) => ReactElement }
    >)
  : {};
const DevPanel = Object.values(devPanelModules)[0]?.DevPanel;

export function Layout() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const tweaks = useAppStore((s) => s.tweaks);
  const addPanelOpen = useAppStore((s) => s.addPanelOpen);
  const setAddPanelOpen = useAppStore((s) => s.setAddPanelOpen);
  const musicModalOpen = useAppStore((s) => s.musicModalOpen);
  const setMusicModalOpen = useAppStore((s) => s.setMusicModalOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setTweak = useAppStore((s) => s.setTweak);
  const drawerOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  const [txConfig, setTxConfig, resetTxConfig] = useTransitionConfig();

  // Native quick-add: the macOS shell (File → New Memo, ⌘N, global hotkey)
  // dispatches this window event to open the add-memo island. Harmless on the
  // plain web build — nothing dispatches it there.
  useEffect(() => {
    const openAdd = () => setAddPanelOpen(true);
    window.addEventListener('openmemo:quick-add', openAdd);
    return () => window.removeEventListener('openmemo:quick-add', openAdd);
  }, [setAddPanelOpen]);

  // Cmd+, on macOS. A client-side route change, so nothing is refetched and the
  // page keeps its state; the shell dispatches the event rather than loading a
  // URL for the same reason.
  useEffect(() => {
    const go = () => navigate('/settings');
    window.addEventListener('openmemo:open-settings', go);
    // The shell dispatches this from the main process and cannot know when the
    // effect has run, so it polls for this marker rather than firing into a
    // document that is painted but not listening yet.
    (window as unknown as { __openmemoSettingsListener?: boolean }).__openmemoSettingsListener = true;
    return () => {
      window.removeEventListener('openmemo:open-settings', go);
      (window as unknown as { __openmemoSettingsListener?: boolean }).__openmemoSettingsListener = false;
    };
  }, [navigate]);

  const [overlayKey, setOverlayKey] = useState(0);
  const [overlayTheme, setOverlayTheme] = useState(tweaks.theme);
  const [colorTransition, setColorTransition] = useState(false);
  const prevTheme = useRef(tweaks.theme);
  const mounted = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  // Live Lenis instance for the current route's pane (null on memo/mobile where
  // Lenis is skipped) — the scroll-restore effect uses it to jump instantly.
  const lenisRef = useRef<Lenis | null>(null);
  // Last scroll offset per route path, so navigating back to a list lands where
  // you left off instead of the top. Layout stays mounted across routes (only
  // <main> is keyed/recreated), so this Map survives navigation.
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const txConfigRef = useRef(txConfig);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror so the theme-transition effect reads the latest config synchronously
  txConfigRef.current = txConfig;

  // Smooth scroll on the main content pane. Lenis hijacks wheel/touch and
  // eases the scrollTop with rAF — same easing-driven feel as motion sites.
  //
  // <main> carries key={location.pathname}, so React swaps in a FRESH DOM node
  // on every route change. This effect must re-run per route to tear down the
  // old Lenis (bound to the now-detached node) and rebind to the new one —
  // otherwise navigating away and back leaves the page unscrollable until a
  // full refresh. Hence location.pathname in the deps.
  //
  // Some pages manage their own native scroll on inner panes while .om-main
  // itself has no overflow: the memo detail page (.om-detail-scroll) and the
  // Ask page (.om-ask-thread + .om-ask-history-list). Binding Lenis to the
  // unscrollable .om-main there hijacks the wheel and starves the inner panes —
  // nothing scrolls at all. Skip Lenis on those routes so native wheel reaches
  // the real scrollers.
  useEffect(() => {
    if (location.pathname.startsWith('/memo/') || location.pathname === '/ask') return;
    // Below lg (phones/tablets) let native momentum scroll own touch — Lenis
    // hijacks it and feels wrong on a touchscreen (ADR-009 #8).
    if (isMobile) return;
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
    lenisRef.current = lenis;
    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [location.pathname, isMobile]);

  // Scroll restoration. <main> is recreated per route (key=pathname), so this
  // re-binds each route: it saves the pane's scrollTop as you scroll and, on
  // mount, restores the saved offset for this path — so back-from-a-memo (any
  // type) returns you to where you were reading, not the top. Async grids may
  // not be tall enough on the first frame, so the restore retries over a few
  // frames until the content height can hold the target.
  useEffect(() => {
    const wrapper = mainRef.current;
    if (!wrapper) return;
    const path = location.pathname;
    const target = scrollPositions.current.get(path) ?? 0;
    const onScroll = () => { scrollPositions.current.set(path, wrapper.scrollTop); };
    wrapper.addEventListener('scroll', onScroll, { passive: true });

    let raf = 0;
    let tries = 0;
    const jump = (y: number) => {
      // Use Lenis when it owns this pane so its internal offset stays in sync;
      // otherwise (mobile/native) set scrollTop directly.
      if (lenisRef.current) lenisRef.current.scrollTo(y, { immediate: true, force: true });
      else wrapper.scrollTop = y;
    };
    const restore = () => {
      if (target <= 0) return;
      const max = wrapper.scrollHeight - wrapper.clientHeight;
      if (max >= target - 4) { jump(target); return; }
      if (tries++ < 30) { raf = requestAnimationFrame(restore); return; }
      if (max > 0) jump(Math.min(target, max)); // content shorter now — clamp
    };
    raf = requestAnimationFrame(restore);

    return () => {
      cancelAnimationFrame(raf);
      wrapper.removeEventListener('scroll', onScroll);
    };
  }, [location.pathname]);

  // Drive theme / accent / background CSS vars from persisted tweaks.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; applyTweaks(tweaks); return; }
    if (prevTheme.current !== tweaks.theme) {
      const oldTheme = prevTheme.current;
      prevTheme.current = tweaks.theme;
      // Hold old theme visually so overlay has a head start
      applyTweaks({ ...tweaks, theme: oldTheme });
      setOverlayTheme(tweaks.theme);
      setOverlayKey((k) => k + 1);
      setColorTransition(true);
      if (colorTimer.current) clearTimeout(colorTimer.current);
      // flip theme after delay — happens UNDER the opaque radial cover, so the
      // blob/UI swap is hidden. Radial then fades out, revealing the new theme.
      setTimeout(() => applyTweaks(tweaks), txConfigRef.current.themeFlipDelay);
      // color override removed after window so FM card animations recover
      colorTimer.current = setTimeout(() => setColorTransition(false), txConfigRef.current.colorWindow);
    } else {
      applyTweaks(tweaks);
    }
  }, [tweaks]);

  // App-level drag-and-drop. Hosting the DndContext here (above both the
  // Sidebar and the routed page) is what lets a memo card be dragged onto a
  // sidebar collection — both live under the same provider. The active page's
  // grid registers its handlers via the bus ref. distance:8 preserves card
  // clicks (see CLAUDE.md dnd-kit gotcha).
  const dndBusRef = useRef<GridDragHandlers>({});
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Global shortcuts: ⌘K search, N new memo (when not typing), Esc closes the
  // mobile drawer.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSidebarOpen(false);
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (!typing && e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) {
        setAddPanelOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setSearchOpen, setAddPanelOpen, setSidebarOpen]);

  // Network came back: drain Telegram now rather than serving out an interval
  // that started before the drop. Telegram only holds a share for 24 hours, so
  // every missed window costs something. The browser fires `online` on a real
  // transition only, and the endpoint is a no-op when the relay is off.
  useEffect(() => {
    const back = () => void settingsApi.telegramPollNow('online').catch(() => {});
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, []);

  // Close the off-canvas drawer whenever the route changes (tapping a nav item
  // inside the drawer navigates, then this dismisses it).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  // Leaving the /space/ route exits the Space (ADR-020). SpacePage syncs
  // activeSpace FROM the URL on entry; the mirror on EXIT must live here, above
  // the routed page, so it runs after navigation and can't be undone by
  // SpacePage's own URL-sync effect racing a sidebar "All Memos" click (the
  // route is the source of truth — see appStore activeSpace). Without this the
  // Space stayed "active" on the dashboard, so New-Memo + file drops kept
  // targeting it after you left.
  useEffect(() => {
    const st = useAppStore.getState();
    if (!location.pathname.startsWith('/space/') && st.activeSpace !== null) {
      st.setActiveSpace(null);
    }
  }, [location.pathname]);

  return (
    <div className={cn('om-app', sidebarCollapsed && 'sidebar-collapsed', colorTransition && 'theme-transitioning', isMobile && drawerOpen && 'drawer-open')}>
      <AudioPlayerProvider>
      <DndBusContext.Provider value={dndBusRef}>
      <DndContext
        sensors={dndSensors}
        collisionDetection={pointerWithin}
        onDragStart={(e) => dndBusRef.current.onDragStart?.(e)}
        onDragOver={(e) => dndBusRef.current.onDragOver?.(e)}
        onDragEnd={(e) => dndBusRef.current.onDragEnd?.(e)}
      >
      <OfflineBar />
      <CloudBackground />
      <div className="om-bg-veil" style={{ opacity: tweaks.bgFade ?? 0 }} aria-hidden />
      <MobileTopBar />
      {isMobile && drawerOpen && (
        <div className="om-drawer-scrim" onClick={() => setSidebarOpen(false)} aria-hidden />
      )}
      <Sidebar />

      <main className="om-main" key={location.pathname} ref={mainRef}>
        <div className="om-main-inner">
          <Outlet />
        </div>
      </main>

      <Onboarding />
      <SearchOverlay />
      <FileDropLayer />
      <AddMemoPanel />
      <MusicAddModal />
      <AppearancePanel />
      <FullscreenWriter />
      <AddCollectionModal />
      <AddSpaceModal />

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
            style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', filter: `blur(${txConfig.blur}px)` }}
          >
            <motion.div
              key={`inner-${overlayKey}`}
              initial={{ clipPath: overlayTheme === 'dark' ? 'circle(0% at 50% 0%)' : 'circle(0% at 50% 100%)', opacity: 1 }}
              animate={{
                clipPath: overlayTheme === 'dark'
                  ? `circle(${txConfig.maxRadius}% at 50% 0%)`
                  : `circle(${txConfig.maxRadius}% at 50% 100%)`,
                opacity: [1, 1, 0],
              }}
              transition={{
                clipPath: { duration: txConfig.clipDuration, ease: [0.15, 0.85, 0.25, 1] as [number, number, number, number] },
                opacity: { duration: txConfig.opacityDuration, times: [0, txConfig.holdPct, 1], ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
              }}
              style={{
                position: 'absolute', inset: 0,
                // OPAQUE fill (no transparent stops). The clip-path circle + blur
                // give the soft growing edge. Inside the circle it fully covers the
                // blobs; outside, blobs stay untouched until the circle reaches them.
                background: overlayTheme === 'dark'
                  ? `radial-gradient(ellipse ${txConfig.gradientSize} at 50% 0%, color-mix(in srgb, var(--accent-deep) ${txConfig.accentTint}%, #0a1640) 0%, color-mix(in srgb, var(--accent-deep) ${Math.round(txConfig.accentTint * 0.6)}%, #0a1438) 70%, color-mix(in srgb, var(--accent-deep) ${Math.round(txConfig.accentTint * 0.4)}%, #060e2a) 100%)`
                  : `radial-gradient(ellipse ${txConfig.gradientSize} at 50% 100%, color-mix(in srgb, var(--accent) ${txConfig.accentTint}%, #ff8c3c) 0%, color-mix(in srgb, var(--accent) ${Math.round(txConfig.accentTint * 0.6)}%, #ffb87a) 70%, color-mix(in srgb, var(--accent) ${Math.round(txConfig.accentTint * 0.4)}%, #ffe0c0) 100%)`,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {(() => {
        // Ask Memo has its own composer at the bottom — the global New-Memo FAB
        // would just clutter that page, so it steps aside entirely there.
        if (location.pathname.startsWith('/ask')) return null;
        // Settings is somewhere you go to change openMemo, not to add to it, and
        // this button is the old corner FAB rather than the bottom bar's island
        // (ADR-021). One lone V1 control on a page with no bottom bar just
        // looked like a leftover, which is what it was.
        if (location.pathname.startsWith('/settings')) return null;
        // On the Music page the FAB opens the dedicated music modal (SpotiFLAC,
        // uploads, playlists) instead of the generic New-Memo panel.
        const onMusic = location.pathname.startsWith('/music');
        const fabOpen = onMusic ? musicModalOpen : addPanelOpen;
        const toggle = () => (onMusic ? setMusicModalOpen(!musicModalOpen) : setAddPanelOpen(!addPanelOpen));
        return (
          <button
            className={cn('om-fab', fabOpen && 'open')}
            onClick={toggle}
            title={fabOpen ? 'Close' : onMusic ? 'Add music' : 'New Memo · N'}
            aria-label={onMusic ? 'Add music' : 'New Memo'}
          >
            <span className="om-fab-icon">
              <Icon name={fabOpen ? 'x' : 'plus'} size={18} />
            </span>
          </button>
        );
      })()}

      <Lightbox />
      <GuideHost />
      <ThumbnailEditHost />
      <PlaylistCoverHost />
      <DeleteToast />
      <NoticeToast />

      {import.meta.env.DEV && DevPanel && (
        <DevPanel
          txConfig={txConfig}
          setTxConfig={setTxConfig}
          resetTxConfig={resetTxConfig}
          onTestTransition={() => setTweak('theme', tweaks.theme === 'light' ? 'dark' : 'light')}
        />
      )}
      </DndContext>
      </DndBusContext.Provider>
      </AudioPlayerProvider>
    </div>
  );
}
