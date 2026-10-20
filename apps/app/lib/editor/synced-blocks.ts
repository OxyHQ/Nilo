/**
 * Synced blocks in the editor. An original is a `sync_block` whose children
 * are its content, edited in place like any container; a reference is a
 * `sync_block` naming its original (`sourceBlockId`, `sourcePageId`) and
 * showing that original's blocks, live, from the original's page
 * (`components/editor/blocks/sync-block.tsx`).
 */
import {
  type Block,
  type BlockSnapshot,
  type CommandContext,
  composeCommands,
  type EditorDocument,
  type EditorStore,
  exportSnapshot,
  insertSnapshot,
  isStructural,
  moveBlocks,
  removeBlocks,
  type Transaction,
} from '@oxy.so/bloom-editor';
import { syncedSource } from '@oxy.so/nilo-contracts';

/** An original, as a reference names it. */
export interface SyncedRef {
  blockId: string;
  pageId: string;
}

/** An original: a synced block holding its own content. */
export function isSyncedOriginal(block: Pick<Block, 'type' | 'props'> | undefined): boolean {
  return block?.type === 'sync_block' && !syncedSource(block.type, block.props);
}

/** The original a block shows, when it is a reference. */
export function referenceOf(block: Pick<Block, 'type' | 'props'> | undefined): SyncedRef | null {
  return block ? syncedSource(block.type, block.props) : null;
}

/** A new original, holding one empty paragraph to write in. */
export const newSyncedOriginal = (): BlockSnapshot => ({
  type: 'sync_block',
  children: [{ type: 'paragraph', text: [] }],
});

/** A reference to `source`, to insert anywhere. */
export const syncedReference = (source: SyncedRef): BlockSnapshot => ({
  type: 'sync_block',
  props: { sourceBlockId: source.blockId, sourcePageId: source.pageId },
});

/**
 * "Copy and sync": the original `blockId` is, or is shown by, or — any other
 * block — the original it now goes into (one undoable change, the block
 * wrapped where it stood). Null for a block that is part of its container's
 * layout (a row, a cell, a column), which cannot be moved into one.
 */
export function syncedSourceFor(
  store: EditorStore,
  pageId: string,
  blockId: string,
): SyncedRef | null {
  const block = store.doc.blocks[blockId];
  if (!block) return null;
  const shown = referenceOf(block);
  if (shown) return shown;
  if (isSyncedOriginal(block)) return { blockId, pageId };
  if (isStructural(store.schema, block.type)) return null;
  let originalId: string | null = null;
  store.sealHistory();
  store.run((ctx) =>
    composeCommands(ctx, [
      (c) => {
        const tx = insertSnapshot(c.doc, [{ type: 'sync_block' }], blockId, c.newId, c.schema);
        const op = tx?.ops[0];
        if (op?.kind === 'insert') originalId = op.blocks[0]?.id ?? null;
        return tx;
      },
      (c) => (originalId ? moveBlocks(c, [blockId], originalId, 'inside') : null),
    ]),
  );
  return originalId && store.doc.blocks[originalId] ? { blockId: originalId, pageId } : null;
}

/**
 * "Unsync": the reference `referenceId` becomes a copy of what its original
 * holds (`source`, the original's page as read), in its place.
 */
export function unsyncReference(
  ctx: CommandContext,
  referenceId: string,
  source: EditorDocument,
  sourceBlockId: string,
): Transaction | null {
  const original = source.blocks[sourceBlockId];
  if (!ctx.doc.blocks[referenceId]) return null;
  const copy = original ? exportSnapshot(source, original.children) : [];
  return composeCommands(ctx, [
    (c) => insertSnapshot(c.doc, copy, referenceId, c.newId, c.schema),
    (c) => removeBlocks(c, [referenceId]),
  ]);
}

/**
 * The originals removing `ids` would take: those blocks and everything inside
 * them (a block's children go with it).
 */
export function originalsWithin(doc: EditorDocument, ids: readonly string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const block = doc.blocks[id];
    if (!block) return;
    if (isSyncedOriginal(block)) found.push(id);
    for (const child of block.children) visit(child);
  };
  for (const id of ids) visit(id);
  return found;
}

/** Whether `blockId` is `ancestorId` or inside it. */
function isWithin(doc: EditorDocument, blockId: string, ancestorId: string): boolean {
  for (let at: string | null = blockId; at; at = doc.blocks[at]?.parent ?? null) {
    if (at === ancestorId) return true;
  }
  return false;
}

/**
 * What pasting `text` into `blockId` of page `pageId` puts there when it is
 * the link "Copy and sync" put on the clipboard (`linkOf(copied)`): a
 * reference to that original. Null for any other text, or where the original
 * would be shown inside itself, which is pasted as the link it is.
 */
export function pastedSyncedReference(
  doc: EditorDocument,
  pageId: string,
  blockId: string,
  text: string,
  copied: SyncedRef | null,
  linkOf: (ref: SyncedRef) => string,
): BlockSnapshot | null {
  if (!copied || text.trim() !== linkOf(copied)) return null;
  if (copied.pageId === pageId && isWithin(doc, blockId, copied.blockId)) return null;
  return syncedReference(copied);
}

/**
 * What "Copy and sync" put on this device's clipboard: the system clipboard
 * holds a link to the block, and this the original itself, for "Paste synced
 * block". Kept for the app's life, as a clipboard is.
 */
let copied: SyncedRef | null = null;
const listeners = new Set<() => void>();
export const syncedClipboard = {
  get: (): SyncedRef | null => copied,
  set(ref: SyncedRef | null): void {
    copied = ref;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
