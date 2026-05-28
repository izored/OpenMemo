import { createContext, useContext, type MutableRefObject, type ReactNode } from 'react';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';

// Bridges the single app-level DndContext (in Layout) to the grid that owns the
// drag logic (MemoGrid). Layout hosts the context so that BOTH the memo cards
// and the Sidebar's collection drop targets live under the same provider — that
// is what lets you drag a card onto a sidebar collection. The grid registers
// its handlers into this ref; Layout's DndContext simply forwards events to them.
export interface GridDragHandlers {
  onDragStart?: (e: DragStartEvent) => void;
  onDragOver?: (e: DragOverEvent) => void;
  onDragEnd?: (e: DragEndEvent) => void;
  renderOverlay?: () => ReactNode;
}

export type GridDragRef = MutableRefObject<GridDragHandlers>;

export const DndBusContext = createContext<GridDragRef | null>(null);

export const useDndBus = () => useContext(DndBusContext);
