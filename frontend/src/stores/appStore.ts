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

  // Theme & appearance
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}

const persist = (partial: Partial<AppState>) => {
  const toSave = {
    theme: partial.theme,
  };
  if (toSave.theme) {
    localStorage.setItem('openmemo_settings', JSON.stringify({
      theme: partial.theme ?? saved.theme ?? 'light',
    }));
  }
};

// Dark mode is manual-toggle only until fully polished.
// Do NOT auto-apply on load — prevents half-baked dark mode flash.
// The toggle in SettingsPage handles adding/removing the .dark class.

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

  theme: saved.theme || 'light',
  setTheme: (theme) => {
    set({ theme });
    persist({ theme });
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  },
}));
