import * as React from 'react';

export type { DropPosition } from '@/lib/sidebar-drop';

interface DragContextValue {
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
}

const DragContext = React.createContext<DragContextValue>({
  draggingId: null,
  setDraggingId: () => undefined,
});

/**
 * Which sidebar page is being dragged, so every row can show where it would
 * land. One provider spans the sidebar's sections: a page dragged from one
 * (private, a teamspace) can be dropped into another. Each tree resolves a
 * drop on its rows itself.
 */
export function PageDragProvider({ children }: { children: React.ReactNode }) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const value = React.useMemo<DragContextValue>(
    () => ({ draggingId, setDraggingId }),
    [draggingId],
  );
  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
}

export function usePageDrag() {
  return React.useContext(DragContext);
}
