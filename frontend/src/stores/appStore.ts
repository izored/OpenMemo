import { create } from 'zustand';
import type { Collection, Memo, MusicPlaylist, Space } from '@/types';
import { DEFAULT_TWEAKS, applyTweaks, type Tweaks } from '@/lib/appearance';

// Ids of the step-by-step guides the GuideModal can render. Add new guides here.
export type GuideId = 'yt-cookies';

const loadTweaks = (): Tweaks => {
  try {
    const raw = localStorage.getItem('openmemo_tweaks');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrations: 'rich'/'hybrid' card style → 'normal'; 1× blob speed → 2×.
      if (parsed.cardStyle === 'rich' || parsed.cardStyle === 'hybrid') parsed.cardStyle = 'normal';
      if (parsed.blobSpeed === 1) parsed.blobSpeed = 2;
      // Blob drift retired (OPNMMO-0048): the old 'random' mode becomes the new
      // cloud shader. Existing users stop seeing blobs without touching settings.
      if (parsed.bgMode === 'random') parsed.bgMode = 'cloud';
      // 'live' is no longer a top-level mode — it's the 'auto' sky band inside
      // Cloud. Fold saved live into cloud + auto so it keeps tracking the clock.
      if (parsed.bgMode === 'live') { parsed.bgMode = 'cloud'; parsed.skyBand = 'auto'; }
      // Gutter is new: seed it from the old per-style gap so existing layouts
      // don't jump (Edge was gapless, everything else the roomy 28px).
      if (typeof parsed.gutter !== 'number') parsed.gutter = parsed.cardStyle === 'edge' ? 0 : 28;
      return { ...DEFAULT_TWEAKS, ...parsed, density: 'roomy' as const };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_TWEAKS };
};

// Load persisted settings from localStorage
const loadSettings = () => {
  try {
    const raw = localStorage.getItem('openmemo_settings');
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
};

const saved = loadSettings();

const FILTER_ORDER_KEY = 'openmemo_filter_order';
const loadFilterOrder = (): string[] => {
  try {
    const raw = localStorage.getItem(FILTER_ORDER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
};

interface AppState {
  // Mobile drawer (reuses the long-present sidebarOpen field — ADR-009).
  // Off-canvas full-screen sidebar below the lg breakpoint; ignored on desktop.
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Filter
  activeFilter: string;
  setActiveFilter: (filter: string) => void;

  // Dashboard filter-tab order (user-draggable, persisted)
  filterOrder: string[];
  setFilterOrder: (order: string[]) => void;

  // Active collection
  activeCollection: string | null;
  setActiveCollection: (id: string | null) => void;

  // Active Space (ADR-020). null = the main library. When set, the app is
  // "inside" that Space: lists scope to it, the sidebar shows its collections,
  // and adds land in it. Persisted so a reload keeps you where you were.
  activeSpace: string | null;
  setActiveSpace: (id: string | null) => void;

  // Space create/edit modal
  spaceModalOpen: boolean;
  setSpaceModalOpen: (open: boolean) => void;
  editingSpace: Space | null;
  setEditingSpace: (space: Space | null) => void;

  // Selected memo (detail view)
  selectedMemoId: string | null;
  setSelectedMemoId: (id: string | null) => void;

  // Chat
  activeChatSession: string | null;
  setActiveChatSession: (id: string | null) => void;
  chatModel: string;
  setChatModel: (model: string) => void;

  // Add modal
  addModalOpen: boolean;
  setAddModalOpen: (open: boolean) => void;
  addModalTab: 'link' | 'note' | 'file';
  setAddModalTab: (tab: 'link' | 'note' | 'file') => void;

  // Collection modal
  collectionModalOpen: boolean;
  setCollectionModalOpen: (open: boolean) => void;
  editingCollection: Collection | null;
  setEditingCollection: (collection: Collection | null) => void;
  // id of a collection just created via the New-collection flow, so the open
  // surface (e.g. AddMemoPanel) can auto-select it. Consumer clears after use.
  lastCreatedCollectionId: string | null;
  setLastCreatedCollectionId: (id: string | null) => void;

  // Add memo panel (design FAB panel)
  addPanelOpen: boolean;
  setAddPanelOpen: (open: boolean) => void;

  // True while a page renders the bottom bar (ADR-021). The bottom bar owns the
  // New-Memo / Add-music flow through its IslandFab, so the GLOBAL corner panels
  // (AddMemoPanel, MusicAddModal) step aside and render null to avoid doubling.
  bottomBarPresent: boolean;
  setBottomBarPresent: (present: boolean) => void;

  // True while a New-Memo save is in flight / a memo is being pulled in the
  // background (OPNMMO-0051). Drives the BorderBeam "working" glow on the island.
  addMemoBusy: boolean;
  setAddMemoBusy: (busy: boolean) => void;

  // Music add-modal (Music page + button — SpotiFLAC, uploads, playlists)
  musicModalOpen: boolean;
  setMusicModalOpen: (open: boolean) => void;

  // Appearance live-preview panel
  appearancePanelOpen: boolean;
  setAppearancePanelOpen: (open: boolean) => void;

  // Fullscreen writer
  writerOpen: boolean;
  setWriterOpen: (open: boolean) => void;

  // Sidebar collapse
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;

  // Search overlay
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Step-by-step guide popup (reusable framework — see GuideModal).
  // null = closed; otherwise the id of the guide to show.
  activeGuide: GuideId | null;
  openGuide: (id: GuideId) => void;
  closeGuide: () => void;

  // Thumbnail editor: the memo whose thumbnail/title is being edited (null = closed).
  editThumbMemo: Memo | null;
  openThumbEdit: (memo: Memo) => void;
  closeThumbEdit: () => void;

  // Playlist/album cover editor: the playlist whose cover is being edited (null = closed).
  editCoverPlaylist: MusicPlaylist | null;
  openCoverEdit: (playlist: MusicPlaylist) => void;
  closeCoverEdit: () => void;

  // Media lightbox (shared across grid — supports prev/next navigation)
  lightboxGroup: Memo[];
  lightboxIndex: number;
  openLightbox: (group: Memo[], index: number) => void;
  closeLightbox: () => void;
  lightboxStep: (delta: number) => void;

  // Appearance tweaks (theme / accent / card / density / grid / background)
  tweaks: Tweaks;
  setTweak: (keyOrPatch: keyof Tweaks | Partial<Tweaks>, value?: unknown) => void;

  // Undo-delete toast
  deleteToast: { memoId: string; title: string } | null;
  showDeleteToast: (memoId: string, title: string) => void;
  clearDeleteToast: () => void;

  // Hidden section (OPNMMO-0016): unlocked for this tab session only — never
  // persisted, so a reload always re-asks for the passcode.
  hiddenUnlocked: boolean;
  setHiddenUnlocked: (unlocked: boolean) => void;

  // Branded notice toast — in-app replacement for window.alert(). Auto-clears
  // from the NoticeToast component.
  notice: { message: string; kind: 'error' | 'info' } | null;
  showNotice: (message: string, kind?: 'error' | 'info') => void;
  clearNotice: () => void;
}

const persist = (partial: { chatModel?: string }) => {
  localStorage.setItem('openmemo_settings', JSON.stringify({
    chatModel: partial.chatModel ?? saved.chatModel ?? '',
  }));
};

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  activeFilter: 'all',
  setActiveFilter: (filter) => set({ activeFilter: filter }),

  filterOrder: loadFilterOrder(),
  setFilterOrder: (order) => {
    localStorage.setItem(FILTER_ORDER_KEY, JSON.stringify(order));
    set({ filterOrder: order });
  },

  activeCollection: null,
  setActiveCollection: (id) => set({ activeCollection: id }),

  // Not persisted: the route is the source of truth. SpacePage re-derives this
  // from the URL on load, so a reload at "/" is the library and a reload at
  // "/space/:id" re-enters the Space. Persisting it caused the sidebar to show
  // a Space open while the library rendered.
  activeSpace: null,
  setActiveSpace: (id) => set({ activeSpace: id }),

  spaceModalOpen: false,
  setSpaceModalOpen: (open) => set({ spaceModalOpen: open }),
  editingSpace: null,
  setEditingSpace: (space) => set({ editingSpace: space }),

  selectedMemoId: null,
  setSelectedMemoId: (id) => set({ selectedMemoId: id }),

  activeChatSession: null,
  setActiveChatSession: (id) => set({ activeChatSession: id }),
  chatModel: saved.chatModel || '',
  setChatModel: (model) => {
    set({ chatModel: model });
    persist({ chatModel: model });
  },

  addModalOpen: false,
  setAddModalOpen: (open) => set({ addModalOpen: open }),
  addModalTab: 'link',
  setAddModalTab: (tab) => set({ addModalTab: tab }),

  collectionModalOpen: false,
  setCollectionModalOpen: (open) => set({ collectionModalOpen: open }),
  editingCollection: null,
  setEditingCollection: (collection) => set({ editingCollection: collection }),
  lastCreatedCollectionId: null,
  setLastCreatedCollectionId: (id) => set({ lastCreatedCollectionId: id }),

  addPanelOpen: false,
  setAddPanelOpen: (open) => set({ addPanelOpen: open }),

  bottomBarPresent: false,
  setBottomBarPresent: (present) => set({ bottomBarPresent: present }),

  addMemoBusy: false,
  setAddMemoBusy: (busy) => set({ addMemoBusy: busy }),

  musicModalOpen: false,
  setMusicModalOpen: (open) => set({ musicModalOpen: open }),

  appearancePanelOpen: false,
  setAppearancePanelOpen: (open) => set({ appearancePanelOpen: open }),

  writerOpen: false,
  setWriterOpen: (open) => set({ writerOpen: open }),

  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  activeGuide: null,
  openGuide: (id) => set({ activeGuide: id }),
  closeGuide: () => set({ activeGuide: null }),

  editThumbMemo: null,
  openThumbEdit: (memo) => set({ editThumbMemo: memo }),
  closeThumbEdit: () => set({ editThumbMemo: null }),

  editCoverPlaylist: null,
  openCoverEdit: (playlist) => set({ editCoverPlaylist: playlist }),
  closeCoverEdit: () => set({ editCoverPlaylist: null }),

  lightboxGroup: [],
  lightboxIndex: -1,
  openLightbox: (group, index) => set({ lightboxGroup: group, lightboxIndex: index }),
  closeLightbox: () => set({ lightboxGroup: [], lightboxIndex: -1 }),
  lightboxStep: (delta) =>
    set((s) => {
      if (s.lightboxIndex < 0 || s.lightboxGroup.length === 0) return {};
      const n = s.lightboxGroup.length;
      return { lightboxIndex: (s.lightboxIndex + delta + n) % n };
    }),

  tweaks: loadTweaks(),
  setTweak: (keyOrPatch, value) =>
    set((s) => {
      const patch =
        typeof keyOrPatch === 'object'
          ? keyOrPatch
          : ({ [keyOrPatch]: value } as Partial<Tweaks>);
      const tweaks = { ...s.tweaks, ...patch };
      localStorage.setItem('openmemo_tweaks', JSON.stringify(tweaks));
      applyTweaks(tweaks);
      return { tweaks };
    }),

  deleteToast: null,
  showDeleteToast: (memoId, title) => set({ deleteToast: { memoId, title } }),
  clearDeleteToast: () => set({ deleteToast: null }),

  hiddenUnlocked: false,
  setHiddenUnlocked: (unlocked) => set({ hiddenUnlocked: unlocked }),

  notice: null,
  showNotice: (message, kind = 'error') => set({ notice: { message, kind } }),
  clearNotice: () => set({ notice: null }),
}));