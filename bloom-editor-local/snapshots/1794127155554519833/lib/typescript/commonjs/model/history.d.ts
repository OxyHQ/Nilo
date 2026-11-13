/**
 * Undo history. Each entry is a transaction; undo applies its inverse.
 *
 * Typing is grouped: consecutive text edits to the same block within
 * `groupWindowMs` merge into one entry, so undo removes a word or a phrase,
 * not a character.
 */
import type { Transaction } from './operations';
export interface HistoryOptions {
    limit?: number;
    groupWindowMs?: number;
}
export declare class History {
    private undoStack;
    private redoStack;
    private readonly limit;
    private readonly groupWindowMs;
    constructor(options?: HistoryOptions);
    record(tx: Transaction, now?: number): void;
    /** Close the current typing group, so the next edit starts a new entry. */
    seal(): void;
    /** The transaction to undo; moves it to the redo stack. */
    popUndo(): Transaction | null;
    /** The transaction to redo; moves it back to the undo stack. */
    popRedo(): Transaction | null;
    get canUndo(): boolean;
    get canRedo(): boolean;
    clear(): void;
}
//# sourceMappingURL=history.d.ts.map