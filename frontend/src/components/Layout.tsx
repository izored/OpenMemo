import { Outlet } from 'react-router-dom';
import { Plus, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AddMemoModal } from './AddMemoModal';
import { AddCollectionModal } from './AddCollectionModal';
import { SearchModal } from './SearchModal';
import { useAppStore } from '@/stores/appStore';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setAddModalOpen = useAppStore((s) => s.setAddModalOpen);
  const bgColor = useAppStore((s) => s.bgColor);

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: bgColor }}>
      {/* Sidebar — push layout with width transition */}
      <div
        className="flex-shrink-0 h-screen overflow-hidden transition-[width] duration-300 ease-out"
        style={{ width: sidebarOpen ? 240 : 0 }}
      >
        <div className="w-60 h-screen">
          <Sidebar />
        </div>
      </div>

      {/* Main content */}
      <main
        className="flex-1 overflow-y-auto min-w-0 px-8 md:px-16 lg:px-20 py-6 relative"
        style={{ backgroundColor: bgColor }}
      >
        <Outlet />
      </main>

      {/* Global hamburger — visible on all pages */}
      <button
        onClick={toggleSidebar}
        className="fixed top-5 left-5 z-50 p-3 rounded-full hover:bg-black/5 transition-colors"
        title="Toggle sidebar"
      >
        <Menu size={22} className="text-[#646464]" />
      </button>

      {/* Floating Add New button — bottom center */}
      <button
        onClick={() => setAddModalOpen(true)}
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-8 py-4 bg-[#202020] text-white rounded-full text-[15px] font-bold shadow-xl hover:bg-[#000] hover:scale-105 transition-all duration-200"
      >
        <Plus size={20} />
        Add New
      </button>

      <AddMemoModal />
      <AddCollectionModal />
      <SearchModal />
    </div>
  );
}
