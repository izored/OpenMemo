import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import {
  Home,
  MessageSquare,
  Radio,
  Plus,
  Pin,
  ChevronLeft,
  Settings,
  Pencil,
} from 'lucide-react';
import { collectionApi } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

function DroppableCollectionItem({
  col,
  activeCollection,
  onNavigate,
  onEdit,
}: {
  col: any;
  activeCollection: string | null;
  onNavigate: () => void;
  onEdit: (e: React.MouseEvent) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `col-${col.id}` });

  return (
    <button
      ref={setNodeRef}
      onClick={onNavigate}
      className={cn(
        'group w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-full text-[14px] transition-colors font-medium',
        isOver
          ? 'bg-[var(--color-brand)]/10 text-[var(--color-brand)] ring-1 ring-[var(--color-brand)]/30'
          : activeCollection === col.id
            ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
      )}
    >
      <span className="text-base leading-none flex-shrink-0">
        {col.emoji || '📁'}
      </span>
      <span className="truncate flex-1 text-left">{col.name}</span>
      {col.pinned && <Pin size={11} className="text-[var(--color-text-muted)] flex-shrink-0" />}
      <span
        onClick={onEdit}
        className={cn(
          'p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0',
          activeCollection === col.id
            ? 'hover:bg-white/20 text-white/70'
            : 'hover:bg-[var(--color-border)] text-[var(--color-text-muted)]'
        )}
        title="Edit collection"
      >
        <Pencil size={11} />
      </span>
    </button>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeCollection, setActiveCollection, toggleSidebar, setCollectionModalOpen, setEditingCollection } = useAppStore();

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });

  const navItems = [
    { icon: Home, label: 'All Memos', path: '/' },
    { icon: MessageSquare, label: 'AskMemo', path: '/ask' },
    { icon: Radio, label: 'MemoCast', path: '/memocast' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const openCreateModal = () => {
    setEditingCollection(null);
    setCollectionModalOpen(true);
  };

  const openEditModal = (e: React.MouseEvent, col: any) => {
    e.stopPropagation();
    setEditingCollection(col);
    setCollectionModalOpen(true);
  };

  return (
    <aside className="w-60 h-screen bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)]/60 flex flex-col">
      {/* Header */}
      <div className="p-5 flex items-center justify-between">
        <div
          className="flex items-center gap-2.5 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <div className="w-8 h-8 rounded-full bg-[var(--color-brand)] flex items-center justify-center">
            <span className="text-white font-bold text-sm">O</span>
          </div>
          <span className="font-bold text-[var(--color-text)] tracking-tight text-[15px]">
            OpenMemo
          </span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-full hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => {
              setActiveCollection(null);
              navigate(item.path);
            }}
            className={cn(
              'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-full text-[14px] transition-colors font-medium',
              location.pathname === item.path && !activeCollection
                ? 'bg-[var(--color-bg-active)] text-[var(--color-text-active)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]'
            )}
          >
            <item.icon size={17} strokeWidth={2} />
            {item.label}
          </button>
        ))}

        {/* Collections */}
        <div className="pt-6">
          <div className="flex items-center justify-between px-3.5 mb-3">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
              Collections
            </span>
            <button
              onClick={openCreateModal}
              className="p-1 rounded-full hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] transition-colors"
              title="New collection"
            >
              <Plus size={13} />
            </button>
          </div>
          {collections.map((col: any) => (
            <DroppableCollectionItem
              key={col.id}
              col={col}
              activeCollection={activeCollection}
              onNavigate={() => {
                setActiveCollection(col.id);
                navigate('/');
              }}
              onEdit={(e) => openEditModal(e, col)}
            />
          ))}
        </div>
      </nav>

      {/* Footer — empty, Add New moved to Layout */}
      <div className="p-4" />
    </aside>
  );
}
