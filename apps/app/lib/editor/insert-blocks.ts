/**
 * Blocks the slash menu inserts with their structure, and where they go.
 */
import {
  type BlockSnapshot,
  composeCommands,
  type EditorStore,
  getBlock,
  insertSnapshot,
  removeBlocks,
} from '@oxy.so/bloom-editor';
import { newSyncedOriginal } from './synced-blocks';

const paragraph = (): BlockSnapshot => ({ type: 'paragraph', text: [] });

/** Containers that arrive with their structure: two columns, a 2×2 table, a synced block. */
export const CONTAINERS: Readonly<Record<string, () => BlockSnapshot>> = {
  columns: () => ({
    type: 'columns',
    props: { columnCount: 2 },
    children: [
      { type: 'column', children: [paragraph()] },
      { type: 'column', children: [paragraph()] },
    ],
  }),
  table: () => ({
    type: 'table',
    props: { rows: 2, cols: 2, withHeader: false },
    children: [0, 1].map(() => ({
      type: 'table_row',
      children: [0, 1].map(() => ({ type: 'table_cell', text: [] })),
    })),
  }),
  syncedBlock: newSyncedOriginal,
};

/**
 * Insert `snapshot` after `blockId`, replacing the block when it is empty.
 * The block gone meanwhile (a collaborator removed it while a database was
 * being made for it), the new block goes at the end of the page instead of
 * nowhere.
 */
export function insertBlockSnapshot(
  store: EditorStore,
  snapshot: BlockSnapshot,
  blockId: string,
): void {
  const anchor = store.doc.blocks[blockId] ? blockId : null;
  const block = anchor ? getBlock(store.doc, anchor) : null;
  const empty =
    block !== null &&
    (block.text ?? []).every((segment) => !segment.text) &&
    block.children.length === 0;
  store.sealHistory();
  store.run((ctx) =>
    composeCommands(ctx, [
      (c) => insertSnapshot(c.doc, [snapshot], anchor, c.newId, c.schema),
      (c) => (empty && anchor ? removeBlocks(c, [anchor]) : null),
    ]),
  );
}

/** Insert a container (`CONTAINERS`) after `blockId`; false for an id that names none. */
export function insertContainer(store: EditorStore, id: string, blockId: string): boolean {
  const make = CONTAINERS[id];
  if (!make) return false;
  insertBlockSnapshot(store, make(), blockId);
  return true;
}
