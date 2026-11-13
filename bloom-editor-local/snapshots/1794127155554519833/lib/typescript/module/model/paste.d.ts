/**
 * Pasting lines into a text block, as Notion does: the first line continues
 * the block where it was pasted, every other line becomes a block after it,
 * and what followed the caret ends the last one. Markdown line prefixes make
 * the block they say — `#`/`##`/`###` headings, `-` `*` `+` bullets, `1.`
 * numbers, `[ ]`/`[x]` to-dos, `>` quotes, `---` dividers, and ``` fences a
 * code block of the lines between them. Lines pasted into a list without a
 * prefix continue the list. The pasted text's marks (a rich paste) are kept.
 * Blank lines separate blocks and make none.
 */
import { type Segment, type TextEdit } from '@oxy.so/bloom-text/model';
import { type CommandContext } from './commands.js';
import type { BlockId } from './document.js';
import { type Transaction } from './operations.js';
import { type BlockSnapshot } from './snapshot.js';
/**
 * When `edit` pasted line breaks into the text block `id`, the transaction
 * that makes blocks of the lines; null when it inserted none, or `id` takes
 * line breaks itself (a code block).
 */
export declare function pasteIntoBlock(ctx: CommandContext, id: BlockId, textAfterPaste: readonly Segment[], edit: TextEdit): Transaction | null;
/**
 * Paste blocks (from HTML, another editor) into the text block `id`, over its
 * `[start, end)`, as Notion does: a single paragraph's text goes in at the
 * caret; otherwise the first pasted block's text continues the block (an
 * empty paragraph becomes the first pasted block), the others follow it, and
 * what followed the selection ends the last one. The caret goes where the
 * pasted content ends. Null for an empty snapshot or a block without text.
 */
export declare function pasteSnapshot(ctx: CommandContext, id: BlockId, start: number, end: number, snapshot: readonly BlockSnapshot[]): Transaction | null;
//# sourceMappingURL=paste.d.ts.map