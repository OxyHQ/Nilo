/**
 * The slash menu's items and search, platform-free.
 *
 * An item either changes the current block's type (when the block is empty,
 * as Notion does) or inserts a block after it, or runs an application action
 * (upload an image, create a database).
 */
export type SlashAction = {
    kind: 'block';
    type: string;
    props?: Record<string, unknown>;
} | {
    kind: 'custom';
    id: string;
};
export interface SlashItem {
    id: string;
    label: string;
    description?: string;
    /** Extra search terms, in any language the app supports. */
    keywords?: readonly string[];
    /** Section the item is listed under. */
    group: string;
    action: SlashAction;
}
/**
 * Whether `/` was just typed where a command can start: at the beginning of
 * the text or after whitespace. Returns the offset of the slash.
 */
export declare function slashTriggerAt(text: string, insertedAt: number, inserted: string): number | null;
/**
 * The query typed after the slash at `slashAt`, up to `caret`, or null when
 * the menu should close (slash deleted, caret moved before it, a space right
 * after the slash, two spaces, a line break).
 */
export declare function slashQuery(text: string, slashAt: number, caret: number): string | null;
/**
 * Items matching `query`, best first: a label prefix beats a keyword prefix,
 * which beats a match anywhere. Equal scores keep the given order. An empty
 * query returns every item.
 */
export declare function filterSlashItems<T extends SlashItem>(items: readonly T[], query: string): T[];
//# sourceMappingURL=slash.d.ts.map