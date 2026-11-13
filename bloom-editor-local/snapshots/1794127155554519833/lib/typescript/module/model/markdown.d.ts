/**
 * Markdown-style shortcuts typed into a block, Notion's set:
 *
 * - At the start of a paragraph, followed by a space: `#` `##` `###`
 *   headings, `-` `*` `+` bullets, `1.` numbers, `[]` to-do (`[x]` checked),
 *   `>` toggle, `"` quote. Three backticks give a code block and three dashes
 *   a divider, without the space.
 * - Inline, when the closing delimiter is typed: `**bold**`, `*italic*` or
 *   `_italic_`, `` `code` ``, `~~strike~~`.
 */
import { type Segment, type TextEdit } from '@oxy.so/bloom-text/model';
import type { CommandContext } from './commands.js';
import type { BlockId } from './document.js';
import type { Transaction } from './operations.js';
interface BlockShortcut {
    pattern: RegExp;
    type: string;
    props?: Record<string, unknown>;
}
/**
 * The block shortcut completed by `edit` in a paragraph, if any: the typed
 * prefix must sit at the very start, and the caret right after it.
 */
export declare function detectBlockShortcut(type: string, textAfterEdit: string, edit: TextEdit | null): (BlockShortcut & {
    prefixLength: number;
}) | null;
/**
 * Turn the paragraph `id` into the shortcut's type, dropping the typed
 * prefix. A divider keeps the rest of the line in a new paragraph below.
 */
export declare function applyBlockShortcut(ctx: CommandContext, id: BlockId, shortcut: BlockShortcut & {
    prefixLength: number;
}): Transaction;
/**
 * When `edit` typed the closing delimiter of an inline shortcut, the segments
 * with the delimiters removed and the mark applied, and where the caret goes.
 */
export declare function applyInlineShortcut(segments: Segment[], edit: TextEdit | null): {
    segments: Segment[];
    caret: number;
} | null;
/** What an inline equation is, as a mention's `attributes.kind`. */
export declare const INLINE_EQUATION_KIND = "equation";
/**
 * When `edit` typed the closing `$$` of `$$…$$`, the segments with it made an
 * inline equation — a mention under `indicator` whose attributes are
 * `{ kind: 'equation', latex }`, showing the LaTeX — and where the caret
 * goes. Null otherwise, and inside inline code or across a mention.
 */
export declare function applyInlineEquation(segments: Segment[], edit: TextEdit | null, indicator: string): {
    segments: Segment[];
    caret: number;
} | null;
export {};
//# sourceMappingURL=markdown.d.ts.map