import React, { useState, useRef } from 'react';
import { Plus, FileText, Link2, File } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

type ModalTab = 'link' | 'note' | 'file';

const FAB_SIZE = 56;
const GAP = 10;
const SLOT = FAB_SIZE + GAP; // 66px per step

// Simple vertical column above the FAB, same right edge.
// Note closest, Multimedia furthest. All tooltips go left.
const ITEMS: { tab: ModalTab; icon: React.ElementType; label: string; ty: string }[] = [
  { tab: 'note', icon: FileText, label: 'Note',      ty: `${-SLOT}px`     },
  { tab: 'link', icon: Link2,   label: 'Link',       ty: `${-SLOT * 2}px` },
  { tab: 'file', icon: File,    label: 'Multimedia', ty: `${-SLOT * 3}px` },
];

export function SpeedDialFAB() {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setAddModalOpen = useAppStore(s => s.setAddModalOpen);
  const setAddModalTab  = useAppStore(s => s.setAddModalTab);

  const openFab = () => {
    clearTimeout(closeTimer.current);
    setIsOpen(true);
  };

  const closeFab = () => {
    closeTimer.current = setTimeout(() => {
      setIsOpen(false);
      setHoveredIdx(null);
    }, 200);
  };

  const handleItemClick = (tab: ModalTab) => {
    setIsOpen(false);
    setAddModalTab(tab);
    setAddModalOpen(true);
  };

  return (
    <div
      className="fixed bottom-8 right-8 z-50"
      style={{ width: FAB_SIZE, height: FAB_SIZE }}
    >
      {ITEMS.map((item, i) => {
        const isHovered = hoveredIdx === i;
        const delay = isOpen ? i * 50 : 0;
        const Icon = item.icon;

        return (
          <div
            key={item.label}
            className="absolute inset-0"
            style={{
              transform: isOpen
                ? `translate(0, ${item.ty}) scale(1)`
                : 'translate(0, 0) scale(0)',
              opacity: isOpen ? 1 : 0,
              transition: `transform 300ms cubic-bezier(0.34,1.56,0.64,1) ${delay}ms, opacity 200ms ease ${delay}ms`,
              pointerEvents: isOpen ? 'auto' : 'none',
            }}
            onMouseEnter={() => { clearTimeout(closeTimer.current); setHoveredIdx(i); }}
            onMouseLeave={() => { setHoveredIdx(null); closeFab(); }}
          >
            {/* Label — left of each button, no overlap possible in a vertical stack */}
            <span
              className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-semibold px-2 py-1 rounded-full pointer-events-none"
              style={{
                backgroundColor: 'var(--color-dark)',
                color: 'var(--color-bg)',
                opacity: isHovered ? 1 : 0,
                transition: `opacity 150ms ease ${isHovered ? '100ms' : '0ms'}`,
              }}
            >
              {item.label}
            </span>

            <button
              onClick={() => handleItemClick(item.tab)}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-md"
              style={{
                backgroundColor: isHovered ? 'var(--color-dark)' : 'var(--color-bg-card)',
                color: isHovered ? 'var(--color-bg)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                transition: 'background-color 150ms, color 150ms, transform 150ms',
              }}
            >
              <Icon size={20} />
            </button>
          </div>
        );
      })}

      {/* Main FAB */}
      <button
        className="absolute inset-0 w-14 h-14 rounded-full flex items-center justify-center shadow-xl"
        style={{ backgroundColor: 'var(--color-dark)', color: 'var(--color-bg)' }}
        onMouseEnter={openFab}
        onMouseLeave={closeFab}
      >
        <Plus
          size={24}
          style={{
            transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
            transition: 'transform 200ms cubic-bezier(0.34,1.56,0.64,1)',
          }}
        />
      </button>
    </div>
  );
}
