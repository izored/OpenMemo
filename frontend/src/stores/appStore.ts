import { create } from 'zustand';
import type { Memo, Collection, MemoType, ChatSession } from '@/types';

// Load persisted settings from localStorage
const loadSettings = () => {
  try {
    const raw = localStorage.getItem('openmemo_settings');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
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

  // Collection modal
  collectionModalOpen: boolean;
  setCollectionModalOpen: (open: boolean) => void;
  editingCollection: Collection | null;
  setEditingCollection: (collection: Collection | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Theme & appearance
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  bgColor: string;
  setBgColor: (color: string) => void;
}

const persist = (partial: Partial<AppState>) => {
  const toSave = {
    theme: partial.theme,
    bgColor: partial.bgColor,
  };
  if (toSave.theme || toSave.bgColor) {
    localStorage.setItem('openmemo_settings', JSON.stringify({
      theme: partial.theme ?? saved.theme ?? 'light',
      bgColor: partial.bgColor ?? saved.bgColor ?? '#F5F0E8',
    }));
  }
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
  chatModel: 'qwen2.5:7b',
  setChatModel: (model) => set({ chatModel: model }),

  addModalOpen: false,
  setAddModalOpen: (open) => set({ addModalOpen: open }),

  collectionModalOpen: false,
  setCollectionModalOpen: (open) => set({ collectionModalOpen: open }),
  editingCollection: null,
  setEditingCollection: (collection) => set({ editingCollection: collection }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),

  theme: saved.theme || 'light',
  setTheme: (theme) => {
    set({ theme });
    persist({ theme });
  },
  bgColor: saved.bgColor || '#F5F0E8',
  setBgColor: (bgColor) => {
    set({ bgColor });
    persist({ bgColor });
  },
}));
