/**
 * Keeping an editor store and a `Y.Doc` the same.
 *
 * Every transaction the person makes (an edit, an undo, a redo) is written
 * into the `Y.Doc` (`write.ts`). Every change the `Y.Doc` takes from anywhere
 * else — a collaborator, work saved on this device, a server — is read back
 * (`materialize.ts`) and applied to the store as a remote transaction
 * (`diff.ts`): outside the undo history, the selection kept.
 */
import * as Y from 'yjs';
import type { EditorStore } from '../model/store.js';
export interface YjsBindingOptions {
    /**
     * Take changes from the `Y.Doc` but write nothing into it. The reader's own
     * changes (a toggle they closed) stay theirs: each change from the `Y.Doc`
     * is applied on top of them, a property changed only where it changed.
     */
    readOnly?: boolean;
}
export declare class YjsBinding {
    readonly store: EditorStore;
    readonly doc: Y.Doc;
    private readonly materializer;
    private readonly stopStore;
    private readonly stopDoc;
    constructor(store: EditorStore, doc: Y.Doc, options?: YjsBindingOptions);
    dispose(): void;
}
//# sourceMappingURL=binding.d.ts.map