import { Outlet } from 'react-router-dom';
import { Plus, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AddMemoModal } from './AddMemoModal';
import { AddCollectionModal } from './AddCollectionModal';
import { useAppStore } from '@/stores/appStore';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setAddModalOpen = useAppStore((s) => s.setAddModalOpen);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Sidebar — push layout with width transition */}
      <div
        className="flex-shrink-0 h-screen overflow-hidden transition-[width] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: sidebarOpen ? 240 : 0 }}
      >
        <div className="w-60 h-screen">
          <Sidebar />
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0 px-8 md:px-16 lg:px-20 py-6 relative bg-[var(--color-bg)]">
        <Outlet />
      </main>

      {/* Global hamburger — fades in after sidebar closes */}
      <button
        onClick={toggleSidebar}
        className="fixed top-5 left-5 z-50 p-3 rounded-full hover:bg-black/5 transition-all duration-[var(--duration-fast)]"
        style={{
          opacity: sidebarOpen ? 0 : 1,
          pointerEvents: sidebarOpen ? 'none' : 'auto',
          transitionDelay: sidebarOpen ? '0ms' : '450ms',
        }}
        title="Toggle sidebar"
      >
        <Menu size={22} className="text-[var(--color-text-secondary)]" />
      </button>

      {/* Floating Add New button — bottom center */}
      <button
        onClick={() => setAddModalOpen(true)}
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-8 py-4 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full text-[15px] font-bold shadow-xl hover:bg-[var(--color-text)] hover:scale-105 transition-all duration-200"
      >
        <Plus size={20} />
        Add New
      </button>

      <AddMemoModal />
      <AddCollectionModal />
    </div>
  );
}
