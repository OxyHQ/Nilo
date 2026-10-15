/**
 * Markdown in and out of the editor: what a page's blocks say as Markdown,
 * and Markdown (an import, an answer to an AI action) as blocks, parsed by the
 * same `@nilo/contracts` reader the API imports with. Each edit is one
 * transaction, so one undo step.
 */
import { type BlockNode, markdownToBlocks } from '@nilo/contracts';
import {
  type BlockId,
  type BlockSnapshot,
  type CommandContext,
  composeCommands,
  type EditorDocument,
  exportSnapshot,
  insertSnapshot,
  moveBlocks,
  removeBlocks,
  snapshotToMarkdown,
  type Transaction,
} from '@oxy.so/bloom-editor/model';
import { fieldsFromContent } from './wire';

/** Markdown as editor blocks, with the props and text the API would store. */
export function markdownToSnapshot(markdown: string): BlockSnapshot[] {
  const toSnapshot = (node: BlockNode): BlockSnapshot => {
    const { text, props } = fieldsFromContent(node.type, node.content);
    return {
      type: node.type,
      ...(text && { text }),
      props,
      ...(node.children.length > 0 && { children: node.children.map(toSnapshot) }),
    };
  };
  return markdownToBlocks(markdown).map(toSnapshot);
}

/** Blocks (with what they hold) as Markdown. */
export function blocksToMarkdownText(doc: EditorDocument, ids: readonly BlockId[]): string {
  return snapshotToMarkdown(exportSnapshot(doc, ids));
}

/** The ids of the blocks a run of Markdown became, from an insert transaction. */
function insertedIds(tx: Transaction): BlockId[] {
  return tx.ops.flatMap((op) => (op.kind === 'insert' && op.blocks[0] ? [op.blocks[0].id] : []));
}

/** Markdown as blocks after `afterId` (at the end of the page when null). */
export function insertMarkdownAfter(
  ctx: CommandContext,
  afterId: BlockId | null,
  markdown: string,
): Transaction | null {
  return insertSnapshot(ctx.doc, markdownToSnapshot(markdown), afterId, ctx.newId, ctx.schema);
}

/** Markdown as blocks at the top of the page. */
export function insertMarkdownAtTop(ctx: CommandContext, markdown: string): Transaction | null {
  const first = ctx.doc.root[0];
  if (!first) return insertMarkdownAfter(ctx, null, markdown);
  let inserted: BlockId[] = [];
  return composeCommands(ctx, [
    (c) => {
      const tx = insertMarkdownAfter(c, null, markdown);
      inserted = tx ? insertedIds(tx) : [];
      return tx;
    },
    (c) => (inserted.length > 0 ? moveBlocks(c, inserted, first, 'before') : null),
  ]);
}

/** A block replaced by the blocks a run of Markdown becomes. Null for empty Markdown. */
export function replaceWithMarkdown(
  ctx: CommandContext,
  blockId: BlockId,
  markdown: string,
): Transaction | null {
  if (markdownToSnapshot(markdown).length === 0) return null;
  return composeCommands(ctx, [
    (c) => insertMarkdownAfter(c, blockId, markdown),
    (c) => removeBlocks(c, [blockId]),
  ]);
}
