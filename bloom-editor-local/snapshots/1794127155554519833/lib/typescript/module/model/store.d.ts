/**
 * The editor store: the document, the selection, and the one path every edit
 * takes — `dispatch(transaction)`.
 *
 * Listeners on `onTransaction` see every applied transaction with its origin,
 * which is how persistence (the Yjs binding, `../yjs`) follows the document
 * without diffing it. `subscribe`/`getSnapshot` fit React's
 * `useSyncExternalStore`.
 */
import type { CommandContext, IdFactory } from './commands.js';
import type { Block, EditorDocument } from './document.js';
import { type HistoryOptions } from './history.js';
import { type EditorSelection, type Transaction } from './operations.js';
import { type Schema } from './schema.js';
/**
 * Where a transaction came from. `local` edits enter the undo history;
 * `remote` ones (another collaborator, a server refresh) do not; `history`
 * is an undo or redo being applied.
 */
export type TransactionOrigin = 'local' | 'remote' | 'history';
export type TransactionListener = (tx: Transaction, origin: TransactionOrigin) => void;
export interface EditorSnapshot {
    doc: EditorDocument;
    selection: EditorSelection | null;
    canUndo: boolean;
    canRedo: boolean;
}
export interface EditorStoreOptions {
    document: EditorDocument;
    schema?: Schema;
    newId: IdFactory;
    /** Hides a block's children from keyboard navigation (closed toggles). */
    isCollapsed?: (block: Block) => boolean;
    history?: HistoryOptions;
}
export type Command = (ctx: CommandContext) => Transaction | null;
export declare class EditorStore {
    readonly schema: Schema;
    /** Mints block ids. */
    readonly newId: IdFactory;
    private readonly isCollapsed;
    private readonly history;
    private snapshot;
    private readonly listeners;
    private readonly transactionListeners;
    constructor(options: EditorStoreOptions);
    readonly subscribe: (listener: () => void) => (() => void);
    readonly getSnapshot: () => EditorSnapshot;
    get doc(): EditorDocument;
    get selection(): EditorSelection | null;
    /** Follow every applied transaction (persistence, collaboration, analytics). */
    onTransaction(listener: TransactionListener): () => void;
    /** The context commands read: current document, schema and id factory. */
    context(): CommandContext;
    /** Run a command; returns whether it changed anything. */
    run(command: Command): boolean;
    dispatch(tx: Transaction | null, origin?: TransactionOrigin): boolean;
    setSelection(selection: EditorSelection | null): void;
    /** Close the current typing group (on blur, on caret jumps). */
    sealHistory(): void;
    undo(): boolean;
    redo(): boolean;
    /**
     * Replace the whole document (initial load, a full server refresh). Clears
     * the history, whose operations describe the old document.
     */
    reset(doc: EditorDocument): void;
    /**
     * Undo and redo apply an entry to the document as it is now, which other
     * people may have changed since: re-recorded against it, text merged, so
     * only this person's own change is taken back or made again.
     */
    private applyHistory;
    private commit;
}
//# sourceMappingURL=store.d.ts.map