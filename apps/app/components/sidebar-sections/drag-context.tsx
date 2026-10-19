import * as React from 'react';
import { type DropPosition, type DropTarget, dropTargetAt, type RowRect } from '@/lib/sidebar-drop';

export type { DropPosition } from '@/lib/sidebar-drop';

/** A row as the native drag sees it: where it is on screen, and what a drop on it does. */
export interface DragRow {
  /** Its frame in window coordinates (`measureInWindow`). */
  measure: () => Promise<Omit<RowRect, 'id'> | null>;
  onDrop: (sourceId: string, position: DropPosition) => void;
}

interface DragContextValue {
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  /** Native: the row and place a drop would land on now. */
  hover: DropTarget | null;
  /** Native: rows register themselves so a drag can find what is under the finger. */
  registerRow: (id: string, row: DragRow) => () => void;
  /** Native: a long press lifted `id`; the rows' frames are read once, now. */
  beginDrag: (id: string) => void;
  /** Native: the finger is at `y` (window coordinates). */
  moveDrag: (y: number) => void;
  /** Native: the finger lifted; with `drop`, drops on the row under it, if any. */
  endDrag: (drop: boolean) => void;
}

const noop = () => undefined;

const DragContext = React.createContext<DragContextValue>({
  draggingId: null,
  setDraggingId: noop,
  hover: null,
  registerRow: () => noop,
  beginDrag: noop,
  moveDrag: noop,
  endDrag: noop,
});

/**
 * Which sidebar page is being dragged, so every row can show where it would
 * land. One provider spans the sidebar's sections: a page dragged from one
 * (private, a teamspace) can be dropped into another. Each tree resolves a
 * drop on its rows itself.
 *
 * On web the rows use HTML5 drag events (`page-row.web.tsx`); on native a
 * long press lifts a row (`page-row.tsx`) and this provider hit-tests the
 * finger against the rows' frames, measured when the drag starts.
 */
export function PageDragProvider({ children }: { children: React.ReactNode }) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<DropTarget | null>(null);
  const rows = React.useRef(new Map<string, DragRow>());
  const drag = React.useRef<{ id: string; rects: RowRect[]; target: DropTarget | null } | null>(
    null,
  );

  const registerRow = React.useCallback((id: string, row: DragRow) => {
    rows.current.set(id, row);
    return () => {
      if (rows.current.get(id) === row) rows.current.delete(id);
    };
  }, []);

  const beginDrag = React.useCallback((id: string) => {
    const session = { id, rects: [] as RowRect[], target: null };
    drag.current = session;
    setDraggingId(id);
    setHover(null);
    void Promise.all(
      [...rows.current.entries()].map(async ([rowId, row]) => {
        const frame = await row.measure();
        return frame ? { id: rowId, ...frame } : null;
      }),
    ).then((rects) => {
      if (drag.current === session) session.rects = rects.filter((r) => r !== null);
    });
  }, []);

  const moveDrag = React.useCallback((y: number) => {
    const session = drag.current;
    if (!session) return;
    const target = dropTargetAt(session.rects, y, session.id);
    const same =
      target?.targetId === session.target?.targetId &&
      target?.position === session.target?.position;
    if (same) return;
    session.target = target;
    setHover(target);
  }, []);

  const endDrag = React.useCallback((drop: boolean) => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    setDraggingId(null);
    setHover(null);
    if (!drop || !session.target) return;
    rows.current.get(session.target.targetId)?.onDrop(session.id, session.target.position);
  }, []);

  const value = React.useMemo<DragContextValue>(
    () => ({ draggingId, setDraggingId, hover, registerRow, beginDrag, moveDrag, endDrag }),
    [draggingId, hover, registerRow, beginDrag, moveDrag, endDrag],
  );
  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
}

export function usePageDrag() {
  return React.useContext(DragContext);
}
