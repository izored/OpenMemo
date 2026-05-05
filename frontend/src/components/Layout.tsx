import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { AddMemoModal } from './AddMemoModal';
import { SearchModal } from './SearchModal';
import { useAppStore } from '@/stores/appStore';

export function Layout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && <Sidebar />}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <AddMemoModal />
      <SearchModal />
    </div>
  );
}
