import { create } from 'zustand';
import type { Collection, Memo } from '@/types';
import { DEFAULT_TWEAKS, applyTweaks, type Tweaks } from '@/lib/appearance';

const loadTweaks = (): Tweaks => {
  try {
    const raw = localStorage.getItem('openmemo_tweaks');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrations: 'rich'/'hybrid' card style → 'normal'; 1× blob speed → 2×.
      if (parsed.cardStyle === 'rich' || parsed.cardStyle === 'hybrid') parsed.cardStyle = 'normal';
      if (parsed.blobSpeed === 1) parsed.blobSpeed = 2;
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

interface AppState {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Filter
  activeFilter: string;
  setActiveFilter: (filter: string) => void;

  // Active collection
  activeCollection: string | null;
  setActiveCollection: (id: string | null) => void;

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

  // Add memo panel (design FAB panel)
  addPanelOpen: boolean;
  setAddPanelOpen: (open: boolean) => void;

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

  // Media lightbox (shared across grid — supports prev/next navigation)
  lightboxGroup: Memo[];
  lightboxIndex: number;
  openLightbox: (group: Memo[], index: number) => void;
  closeLightbox: () => void;
  lightboxStep: (delta: number) => void;

  // Appearance tweaks (theme / accent / card / density / grid / background)
  tweaks: Tweaks;
  setTweak: (keyOrPatch: keyof Tweaks | Partial<Tweaks>, value?: unknown) => void;
}

const persist = (partial: { chatModel?: string }) => {
  localStorage.setItem('openmemo_settings', JSON.stringify({
    chatModel: partial.chatModel ?? saved.chatModel ?? '',
  }));
};

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  activeFilter: 'all',
  setActiveFilter: (filter) => set({ activeFilter: filter }),

  activeCollection: null,
  setActiveCollection: (id) => set({ activeCollection: id }),

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

  addPanelOpen: false,
  setAddPanelOpen: (open) => set({ addPanelOpen: open }),

  appearancePanelOpen: false,
  setAppearancePanelOpen: (open) => set({ appearancePanelOpen: open }),

  writerOpen: false,
  setWriterOpen: (open) => set({ writerOpen: open }),

  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

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
}));