/**
 * Editing commands. Each reads the document and returns the transaction that
 * performs one user action — or null when the action does not apply — so the
 * keyboard, menus, AI and tests all edit through the same code.
 *
 * The behaviour follows Notion: Return splits and continues lists, an empty
 * list item leaves the list, Backspace at the start reverts a styled block to
 * a paragraph before merging, Tab nests under the previous sibling, and
 * Shift-Tab adopts the following siblings.
 */
import { type Segment, type TextEdit, type TextMarks } from '@oxy.so/bloom-text/model';
import { type Block, type BlockId, type EditorDocument } from './document.js';
import type { EditorSelection, Transaction } from './operations.js';
import { type Schema } from './schema.js';
export type IdFactory = () => BlockId;
export interface CommandContext {
    doc: EditorDocument;
    schema: Schema;
    newId: IdFactory;
    /** Hides children of collapsed blocks from navigation (closed toggles). */
    isCollapsed?: (block: Block) => boolean;
}
/** The previous block on screen that carries text, skipping hidden children. */
export declare function previousTextBlock(ctx: CommandContext, id: BlockId): BlockId | null;
/** The next block on screen that carries text. */
export declare function nextTextBlock(ctx: CommandContext, id: BlockId): BlockId | null;
/** Replace a block's text after an edit in its input. */
export declare function editText(ctx: CommandContext, id: BlockId, next: Segment[], selectionAfter?: EditorSelection): Transaction;
/** Apply one text edit to a block, keeping marks outside it. */
export declare function applyEdit(ctx: CommandContext, id: BlockId, edit: TextEdit): Transaction;
/** Set or clear marks on `[start, end)` of a block's text. */
export declare function formatText(ctx: CommandContext, id: BlockId, start: number, end: number, marks: {
    [K in keyof TextMarks]?: TextMarks[K] | null;
}): Transaction | null;
/** Merge `patch` into a block's props (`undefined` removes a key). */
export declare function setProps(ctx: CommandContext, id: BlockId, patch: Record<string, unknown>): Transaction;
/**
 * Whether `id` can become `type` without losing anything: a type without text
 * (an image, a divider) only takes a block whose text is empty.
 */
export declare function canTurnInto(ctx: Pick<CommandContext, 'doc' | 'schema'>, id: BlockId, type: string): boolean;
/**
 * Change a block's type, keeping its text and props (so turning a to-do into a
 * paragraph and back keeps `checked`, as Notion does) unless the new type
 * lists the props it keeps. The new type's default props fill gaps; text is
 * added or kept per the new type. Refused (null) when the new type has no
 * text and the block has some: it would be gone once the document is saved.
 *
 * Explicit `props` select the destination variant as well as its type. An
 * omitted `childrenWhen` flag in that object selects the ordinary variant.
 * Resolve both together before placing children: a toggle heading must not
 * briefly become a childless heading. Without `props`, legacy callers keep
 * the current props/variant.
 */
export declare function turnInto(ctx: CommandContext, id: BlockId, type: string, props?: Readonly<Record<string, unknown>>): Transaction | null;
/** Insert a new block after `afterId` (or at the end when null). */
export declare function insertBlockAfter(ctx: CommandContext, afterId: BlockId | null, type: string, init?: {
    text?: Segment[];
    props?: Readonly<Record<string, unknown>>;
}): Transaction;
/**
 * Add a block as the last child of `parentId` (into an empty container, at
 * the end of a note). Null when that block takes no children.
 */
export declare function appendChild(ctx: CommandContext, parentId: BlockId, type: string, init?: {
    text?: Segment[];
    props?: Readonly<Record<string, unknown>>;
}): Transaction | null;
/**
 * Return in a text block with the caret at `offset`.
 *
 * - In an empty list-like block: leave it — outdent when nested, else revert
 *   to a paragraph.
 * - Otherwise split the text. The tail goes to a new block of the type the
 *   spec continues as (lists continue, headings give a paragraph); a split
 *   in the middle keeps the type on both halves. When the block shows
 *   children, the new block becomes its first child.
 */
export declare function splitBlock(ctx: CommandContext, id: BlockId, offset: number): Transaction | null;
/**
 * Backspace with the caret at the very start of a text block.
 *
 * Reverts a styled block to a paragraph, then outdents a nested paragraph,
 * then merges the paragraph into the previous text block (its children move
 * to that block). An empty block after a non-text block (divider, image)
 * removes the empty block.
 */
export declare function backspaceAtStart(ctx: CommandContext, id: BlockId): Transaction | null;
/** Delete with the caret at the end: pull the next text block's text in. */
export declare function deleteAtEnd(ctx: CommandContext, id: BlockId): Transaction | null;
/** Tab: nest the block as the last child of its previous sibling. */
export declare function indent(ctx: CommandContext, id: BlockId, selection?: EditorSelection | null): Transaction | null;
/**
 * Shift-Tab: move the block to just after its parent. Its following siblings
 * become its children, so the visual order does not change.
 */
export declare function outdent(ctx: CommandContext, id: BlockId, selection?: EditorSelection | null): Transaction | null;
/**
 * Tab on selected blocks: each nests under the block before it, so a run of
 * siblings goes under the one above the first. Null when the first cannot
 * nest (it is the first of its list), as in Notion.
 */
export declare function indentBlocks(ctx: CommandContext, ids: readonly BlockId[]): Transaction | null;
/**
 * Shift-Tab on selected blocks: each moves out of its parent, last first, so
 * they stay in their order and none takes another as a child. Null when none
 * can move out.
 */
export declare function outdentBlocks(ctx: CommandContext, ids: readonly BlockId[]): Transaction | null;
/** Merge `patch` into the props of every block in `ids`, as one edit. */
export declare function setBlocksProps(ctx: CommandContext, ids: readonly BlockId[], patch: Record<string, unknown>): Transaction | null;
/** A mention to put in a block's text: what it shows and what it points at. */
export interface MentionInsert {
    indicator: string;
    /** The text the mention shows. */
    text: string;
    attributes: Readonly<Record<string, string>>;
}
/**
 * Put a mention over `[start, end)` of a block's text (at the caret when they
 * are equal): an atomic run, the caret after it. Null for an empty mention.
 */
export declare function insertMention(ctx: CommandContext, id: BlockId, start: number, end: number, mention: MentionInsert): Transaction | null;
/** Delete blocks (and their subtrees). Focus lands on the text block before them. */
export declare function removeBlocks(ctx: CommandContext, ids: readonly BlockId[]): Transaction | null;
/** Copy blocks (with their subtrees) to just after the last of them. */
export declare function duplicateBlocks(ctx: CommandContext, ids: readonly BlockId[]): Transaction | null;
/** A copy of a subtree with fresh ids, parents before children. */
export declare function cloneSubtree(ctx: CommandContext, doc: EditorDocument, id: BlockId, parent: BlockId | null): Block[];
export type DropPosition = 'before' | 'after' | 'inside';
/**
 * Move blocks next to (or into) `target`, keeping their relative order.
 * Returns null when the move would place a block inside itself.
 */
export declare function moveBlocks(ctx: CommandContext, ids: readonly BlockId[], target: BlockId, position: DropPosition): Transaction | null;
/**
 * Run commands in sequence as one transaction (one undo step): each sees the
 * document the previous ones produced. A command returning null is skipped.
 * Null when none applied.
 */
export declare function composeCommands(ctx: CommandContext, commands: readonly ((ctx: CommandContext) => Transaction | null)[]): Transaction | null;
//# sourceMappingURL=commands.d.ts.map