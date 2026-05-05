import { create } from 'zustand';
import type { Memo, Collection, MemoType, ChatSession } from '@/types';

interface AppState {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // View
  viewMode: 'grid' | 'list' | 'timeline';
  setViewMode: (mode: 'grid' | 'list' | 'timeline') => void;

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

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  viewMode: 'grid',
  setViewMode: (mode) => set({ viewMode: mode }),

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

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
}));
