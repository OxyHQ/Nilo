import * as React from 'react';
import { SharedPageRow, type PageRowSharedProps } from './shared-page-row';
import { dropPositionAt } from '@/lib/sidebar-drop';
import { usePageDrag, type DropPosition } from './drag-context';

export type { PageRowSharedProps };

const DRAG_MIME = 'application/x-oxy-page-id';

/**
 * Web sidebar page row with HTML5 drag-and-drop. Wraps the cross-platform
 * `SharedPageRow` and resolves the row's underlying DOM node via a stable
 * `nativeID` (which Expo renders as `id` on web). We avoid passing a ref
 * across the View/HTMLElement type boundary that way.
 *
 * Drop zones in a row:
 *  - top quarter → "before" (sibling above target)
 *  - middle half → "inside" (becomes a child of target)
 *  - bottom quarter → "after" (sibling below target)
 */
export function SidebarPageRow(props: PageRowSharedProps) {
  const { page, enableDrag = true, onDrop } = props;
  const drag = usePageDrag();
  const [dropIndicator, setDropIndicator] = React.useState<DropPosition | null>(null);
  const isDragging = drag.draggingId === page.id;
  const domId = React.useMemo(() => `sidebar-page-row-${page.id}`, [page.id]);

  const computePosition = React.useCallback((node: HTMLElement, clientY: number): DropPosition => {
    const rect = node.getBoundingClientRect();
    return dropPositionAt((clientY - rect.top) / rect.height);
  }, []);

  // The listeners are bound once per row and read what changes between
  // renders (the dragged page, the drop handler) from refs: rebinding them on
  // every render dropped events mid-drag.
  const latest = React.useRef({ drag, onDrop, pageId: page.id });
  React.useLayoutEffect(() => {
    latest.current = { drag, onDrop, pageId: page.id };
  });

  React.useEffect(() => {
    if (!enableDrag) return;
    const node = typeof document !== 'undefined' ? document.getElementById(domId) : null;
    if (!node) return;

    node.setAttribute('draggable', 'true');

    const onDragStart = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      const { drag, pageId } = latest.current;
      e.dataTransfer.setData(DRAG_MIME, pageId);
      // Fallback so other browsers can read the id.
      e.dataTransfer.setData('text/plain', pageId);
      drag.setDraggingId(pageId);
    };

    const onDragEnd = () => {
      latest.current.drag.setDraggingId(null);
      setDropIndicator(null);
    };

    const onDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types || (!types.includes(DRAG_MIME) && !types.includes('text/plain'))) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const { drag, pageId } = latest.current;
      if (!drag.draggingId || drag.draggingId === pageId) {
        setDropIndicator(null);
        return;
      }
      setDropIndicator(computePosition(node, e.clientY));
    };

    const onDragLeave = () => setDropIndicator(null);

    const onDropEvent = (e: DragEvent) => {
      e.preventDefault();
      const sourceId =
        e.dataTransfer?.getData(DRAG_MIME) || e.dataTransfer?.getData('text/plain') || '';
      const position = computePosition(node, e.clientY);
      const { drag, onDrop, pageId } = latest.current;
      setDropIndicator(null);
      drag.setDraggingId(null);
      if (!sourceId || sourceId === pageId) return;
      onDrop?.(sourceId, position);
    };

    node.addEventListener('dragstart', onDragStart);
    node.addEventListener('dragend', onDragEnd);
    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDropEvent);

    return () => {
      node.removeAttribute('draggable');
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('dragend', onDragEnd);
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDropEvent);
    };
  }, [computePosition, domId, enableDrag]);

  return (
    <SharedPageRow
      {...props}
      platformDrag={{
        draggable: enableDrag,
        isDragging,
        dropIndicator,
        domId,
      }}
    />
  );
}
