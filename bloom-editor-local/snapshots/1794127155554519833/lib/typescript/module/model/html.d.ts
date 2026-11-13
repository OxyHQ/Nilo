import type { Schema } from './schema.js';
import type { BlockSnapshot } from './snapshot.js';
interface Element {
    tag: string;
    attrs: Record<string, string>;
    children: Node[];
}
type Node = Element | string;
/** The element tree of `html`, under a root element. */
export declare function parseHtmlTree(html: string): Element;
/** Options for `htmlToSnapshot`. */
export interface HtmlToSnapshotOptions {
    /**
     * The editor's schema: a block type it does not have becomes a paragraph
     * (an image it has no type for is dropped), and tables are kept as tables
     * only when it has `table`, `table_row` and `table_cell`.
     */
    schema?: Schema;
    /**
     * The block an image in the HTML becomes; null drops it. By default an
     * `image` block with `url` and `alt`, for an `http(s)` source only.
     */
    image?: (image: {
        src: string;
        alt: string;
    }) => BlockSnapshot | null;
}
/**
 * Block snapshots for pasted HTML. Returns `[]` when it holds nothing
 * (whitespace, a lone comment).
 */
export declare function htmlToSnapshot(html: string, options?: HtmlToSnapshotOptions): BlockSnapshot[];
/**
 * Whether a snapshot says no more than its plain text would: paragraphs
 * without marks. A paste like that is better read as text (its Markdown
 * prefixes make blocks).
 */
export declare function isPlainSnapshot(snapshot: readonly BlockSnapshot[]): boolean;
export {};
//# sourceMappingURL=html.d.ts.map