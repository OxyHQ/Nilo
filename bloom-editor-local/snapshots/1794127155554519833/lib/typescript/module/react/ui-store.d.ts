import type { ActiveMarks } from '@oxy.so/bloom-text/model';
import type { BlockId } from '../model/document.js';
import type { FormatAction, MentionItem } from './context.js';
/** Transient editor UI state, kept out of the document and its history. */
export interface UiState {
    /** The open slash menu: the block, where the slash is, the typed query. */
    slash: {
        blockId: BlockId;
        slashAt: number;
        query: string;
        highlighted: number;
    } | null;
    /** The open mention menu: the block, the indicator and text typed after it, the matches. */
    mention: {
        blockId: BlockId;
        indicator: string;
        text: string;
        highlighted: number;
        items: readonly MentionItem[];
        loading: boolean;
    } | null;
    /** The block whose text input has the keyboard. */
    focused: BlockId | null;
    /** The formatting active at the focused block's selection, as its input reports it. */
    marks: {
        blockId: BlockId;
        marks: ActiveMarks;
    } | null;
    /** The block whose selection a link is being entered for. */
    linking: BlockId | null;
    /** The block whose options menu is open. */
    blockMenu: BlockId | null;
    /** Blocks selected as whole blocks (Escape, Shift-click, drag selection). */
    selectedBlocks: readonly BlockId[];
    /** Where a block selection started, and where Shift-click or Shift-arrows took it. */
    selectionAnchor: BlockId | null;
    selectionHead: BlockId | null;
    /** The code block whose language menu is open. */
    codeLanguageMenu: BlockId | null;
    /** The block under the pointer (web), for its gutter handle. */
    hovered: BlockId | null;
    /** The application's actions on selected text, as the editor was given them. */
    formatActions: readonly FormatAction[];
    /** A block being dragged and where it would drop. */
    drag: {
        ids: readonly BlockId[];
        target: BlockId | null;
        position: 'before' | 'after' | 'inside';
    } | null;
}
export declare class UiStore {
    private state;
    private readonly listeners;
    readonly subscribe: (listener: () => void) => () => boolean;
    readonly get: () => UiState;
    set(patch: Partial<UiState>): void;
}
/** Read a slice of UI state; re-renders only when the slice changes. */
export declare function useUi<T>(store: UiStore, select: (state: UiState) => T): T;
//# sourceMappingURL=ui-store.d.ts.map