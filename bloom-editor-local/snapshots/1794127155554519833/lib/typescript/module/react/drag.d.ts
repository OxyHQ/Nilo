import type { BlockId } from '../model/document.js';
import type { EditorStore } from '../model/store.js';
import type { UiStore } from './ui-store.js';
/** Native: blocks move through the block menu, not by dragging the gutter. */
export declare function startBlockDrag(_store: EditorStore, _ui: UiStore, _id: BlockId, _start: {
    x: number;
    y: number;
}, _prefix: string): void;
//# sourceMappingURL=drag.d.ts.map