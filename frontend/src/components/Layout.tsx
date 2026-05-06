import { Outlet, useLocation } from 'react-router-dom';
import { Plus, Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AddMemoModal } from './AddMemoModal';
import { AddCollectionModal } from './AddCollectionModal';
import { useAppStore } from '@/stores/appStore';

const ADD_NEW_ROUTES = ['/'];

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setAddModalOpen = useAppStore((s) => s.setAddModalOpen);
  const location = useLocation();

  const showAddNew = ADD_NEW_ROUTES.includes(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Backdrop — click to close sidebar */}
      <div
        onClick={toggleSidebar}
        className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200"
        style={{ opacity: sidebarOpen ? 1 : 0, pointerEvents: sidebarOpen ? 'auto' : 'none' }}
      />

      {/* Sidebar — overlay, slides in from left */}
      <div
        className="fixed left-0 top-0 h-screen z-40 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        <Sidebar />
      </div>

      {/* Main content — always full width, no shift */}
      <main className="flex-1 overflow-y-auto min-w-0 px-8 md:px-16 lg:px-20 py-6 relative bg-[var(--color-bg)]">
        <Outlet />
      </main>

      {/* Hamburger / X — morphs in place */}
      <button
        onClick={toggleSidebar}
        className="fixed top-5 left-5 z-50 p-2.5 rounded-full hover:bg-[var(--color-bg-hover)] transition-colors duration-150"
        title="Toggle sidebar"
      >
        <div className="relative w-5 h-5">
          <Menu
            size={20}
            className="absolute inset-0 text-[var(--color-text-secondary)] transition-all duration-150"
            style={{
              opacity: sidebarOpen ? 0 : 1,
              transform: sidebarOpen ? 'rotate(90deg) scale(0.7)' : 'rotate(0deg) scale(1)',
            }}
          />
          <X
            size={20}
            className="absolute inset-0 text-[var(--color-text-secondary)] transition-all duration-150"
            style={{
              opacity: sidebarOpen ? 1 : 0,
              transform: sidebarOpen ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.7)',
            }}
          />
        </div>
      </button>

      {/* Add New — dashboard only */}
      {showAddNew && (
        <button
          onClick={() => setAddModalOpen(true)}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-8 py-4 bg-[var(--color-bg-active)] text-[var(--color-text-active)] rounded-full text-[15px] font-bold shadow-xl hover:bg-[var(--color-text)] hover:scale-105 transition-all duration-200"
        >
          <Plus size={20} />
          Add New
        </button>
      )}

      <AddMemoModal />
      <AddCollectionModal />
    </div>
  );
}
