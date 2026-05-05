import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  MessageSquare,
  Radio,
  FolderOpen,
  Plus,
  Pin,
  ChevronLeft,
  Settings,
} from 'lucide-react';
import { collectionApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCollection, setActiveCollection, toggleSidebar, setAddModalOpen } = useAppStore();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const navItems = [
    { icon: Home, label: 'All Memos', path: '/' },
    { icon: MessageSquare, label: 'AskMemo', path: '/ask' },
    { icon: Radio, label: 'MemoCast', path: '/memocast' },
  ];

  return (
    <aside className="w-64 h-screen bg-[#F8F9FA] border-r border-[#E5E7EB] flex flex-col">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-8 h-8 rounded-lg bg-[#D97706] flex items-center justify-center">
            <span className="text-white font-bold text-sm">O</span>
          </div>
          <span className="font-semibold text-[#1F2937]">OpenMemo</span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-[#E5E7EB] text-[#6B7280]"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => {
              setActiveCollection(null);
              navigate(item.path);
            }}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              location.pathname === item.path && !activeCollection
                ? 'bg-[#FEF3C7] text-[#D97706] font-medium'
                : 'text-[#6B7280] hover:bg-[#F3F4F6]'
            )}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}

        {/* Collections */}
        <div className="pt-4">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">
              Collections
            </span>
            <button
              onClick={() => {/* TODO: create collection modal */}}
              className="p-0.5 rounded hover:bg-[#E5E7EB] text-[#9CA3AF]"
            >
              <Plus size={14} />
            </button>
          </div>
          {collections.map((col: any) => (
            <button
              key={col.id}
              onClick={() => {
                setActiveCollection(col.id);
                navigate('/');
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                activeCollection === col.id
                  ? 'bg-[#FEF3C7] text-[#D97706] font-medium'
                  : 'text-[#6B7280] hover:bg-[#F3F4F6]'
              )}
            >
              <FolderOpen size={16} style={{ color: col.color }} />
              <span className="truncate flex-1 text-left">{col.name}</span>
              {col.pinned && <Pin size={12} className="text-[#9CA3AF]" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-[#E5E7EB]">
        <button
          onClick={() => setAddModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#D97706] text-white rounded-lg text-sm font-medium hover:bg-[#B45309] transition-colors"
        >
          <Plus size={18} />
          Add New
        </button>
      </div>
    </aside>
  );
}
