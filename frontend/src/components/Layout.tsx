import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AddMemoModal } from './AddMemoModal';
import { AddCollectionModal } from './AddCollectionModal';
import { SpeedDialFAB } from './SpeedDialFAB';
import { useAppStore } from '@/stores/appStore';

const ADD_NEW_ROUTES = ['/'];

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const location = useLocation();

  const showAddNew = ADD_NEW_ROUTES.includes(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Sidebar — flex item, pushes content */}
      <div
        className="h-screen flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: sidebarOpen ? '240px' : '0px' }}
      >
        <div className="w-[240px] h-full">
          <Sidebar />
        </div>
      </div>

      {/* Main content */}
      <div className="relative flex-1 min-w-0 overflow-x-hidden">
        {/* Backdrop — dims content when sidebar open, click to close */}
        <div
          onClick={toggleSidebar}
          className="absolute inset-0 z-30 bg-black/10 transition-opacity duration-200 pointer-events-none"
          style={{ opacity: sidebarOpen ? 1 : 0, pointerEvents: sidebarOpen ? 'auto' : 'none' }}
        />
        <main className="h-full overflow-y-auto px-8 md:px-16 lg:px-20 py-6 bg-[var(--color-bg)]">
          <Outlet />
        </main>
      </div>

      {/* Hamburger — hidden behind sidebar when open */}
      <button
        onClick={toggleSidebar}
        className="fixed top-5 left-5 z-50 p-2.5 rounded-full hover:bg-[var(--color-bg-hover)] transition-all duration-150"
        style={{ opacity: sidebarOpen ? 0 : 1, pointerEvents: sidebarOpen ? 'none' : 'auto' }}
        title="Open sidebar"
      >
        <Menu size={20} className="text-[var(--color-text-secondary)]" />
      </button>

      {showAddNew && <SpeedDialFAB />}

      <AddMemoModal />
      <AddCollectionModal />
    </div>
  );
}
