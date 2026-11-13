import type { BlockId } from '../model/document';
import type { EditorStore } from '../model/store';
import type { UiStore } from './ui-store';
/**
 * Web: drag a block (or the selected blocks it belongs to) by its gutter
 * handle. The pointer is followed on the window; a drop runs `moveBlocks`.
 * Under the threshold it stays a click, which opens the block menu.
 */
export declare function startBlockDrag(store: EditorStore, ui: UiStore, id: BlockId, start: {
    x: number;
    y: number;
}, prefix: string): void;
//# sourceMappingURL=drag.web.d.ts.map