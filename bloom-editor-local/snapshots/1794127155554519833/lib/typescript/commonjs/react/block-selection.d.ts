import type { BlockId } from '../model/document';
import type { EditorStore } from '../model/store';
import type { UiStore } from './ui-store';
/** Select `ids` as whole blocks, remembering where the selection runs from and to. */
export declare function selectBlocks(ui: UiStore, ids: readonly BlockId[], anchor?: BlockId | null, head?: BlockId | null): void;
export declare function clearBlockSelection(ui: UiStore): void;
/**
 * Shift-click: the blocks from where the selection started — the selected
 * blocks' anchor, or the block being edited — to `to`. False when there is
 * nowhere to start from.
 */
export declare function extendBlockSelection(store: EditorStore, ui: UiStore, to: BlockId): boolean;
/**
 * An arrow key on selected blocks: with Shift the head moves and the range
 * follows it; without, the block after (or before) the selection is selected
 * alone. False at either end of the page.
 */
export declare function stepBlockSelection(store: EditorStore, ui: UiStore, direction: 'up' | 'down', extend: boolean): boolean;
//# sourceMappingURL=block-selection.d.ts.map