import { type BlockId, type EditorDocument } from './document.js';
/**
 * What each block type does under the editor's commands. The schema is data,
 * so an application adds its own block types without touching the commands.
 */
export interface BlockSpec {
    type: string;
    /** Carries inline text edited with a rich text input. */
    hasText: boolean;
    /** Return inserts a line break instead of splitting (code). */
    multiline?: boolean;
    /** May hold child blocks (indentation, toggles, containers). */
    canHaveChildren: boolean;
    /**
     * May hold children while this prop is true, though `canHaveChildren` is
     * false: a heading made a toggle (`toggleable`). See `acceptsChildren`.
     */
    childrenWhen?: string;
    /**
     * Children are laid out by the block itself (columns, tables) rather than
     * indented under it; nothing indents into or out of such a block.
     */
    isContainer?: boolean;
    /** The only types its children may be: a table's rows, a row's cells. */
    childTypes?: readonly string[];
    /**
     * A part of its parent's layout (a row, a cell, a column): it lives only in
     * a block of one of these types, never at the top or elsewhere, and is not
     * dragged or handled on its own.
     */
    parentTypes?: readonly string[];
    /**
     * Takes an equal share of its parent's width (a table's cell, a column):
     * the application lays such a parent's children out in a row.
     */
    grow?: boolean;
    /**
     * The type of the block Return creates after this one when the caret is at
     * the end. Lists continue themselves; headings and quotes give a paragraph.
     * Defaults to `'paragraph'`.
     */
    continueAs?: string;
    /** Return in an empty block of this type leaves it (outdent, then paragraph). */
    exitOnEmptyReturn?: boolean;
    /** Backspace at the very start turns the block into a paragraph first. */
    revertOnBackspace?: boolean;
    /** Props a new block of this type starts with. */
    defaultProps?: Readonly<Record<string, unknown>>;
    /**
     * The props this type keeps, when the application's storage accepts only
     * those. Commands drop any other prop (turning a to-do into a paragraph
     * loses `checked`), so the editor never holds what the server would
     * discard. When absent, every prop is kept.
     */
    props?: readonly string[];
    /**
     * Props that do not carry over when Return continues the type (a new to-do
     * starts unchecked).
     */
    resetOnContinue?: readonly string[];
}
export type Schema = Readonly<Record<string, BlockSpec>>;
/** The block types every Bloom editor understands. */
export declare const DEFAULT_SCHEMA: Schema;
export declare function defineSchema(specs: readonly BlockSpec[]): Schema;
/** A schema with `specs` added or replacing types of the same name. */
export declare function extendSchema(base: Schema, specs: readonly BlockSpec[]): Schema;
/**
 * A block's props under `spec`: the type's defaults under `props`, without
 * the props the type does not keep.
 */
export declare function propsFor(spec: BlockSpec, props?: Readonly<Record<string, unknown>>): Record<string, unknown>;
/** The spec for `type`; unknown types behave as plain, childless, textless blocks. */
export declare function specOf(schema: Schema, type: string): BlockSpec;
/**
 * Whether a block of `type` may sit in `parent` (null: the top of the page),
 * as far as either one's `childTypes` and `parentTypes` say.
 */
export declare function canHold(schema: Schema, parent: {
    type: string;
} | null, type: string): boolean;
/** The block `id` sits in; null at the top of the page. */
export declare function parentOf(doc: EditorDocument, id: BlockId): {
    type: string;
} | null;
/**
 * Where blocks of `types` go after `afterId` (null: the end of the page):
 * just after it, or — when its parent cannot hold them (a cell's row, a
 * row's table) — just after the nearest ancestor whose parent can.
 */
export declare function placeAfter(doc: EditorDocument, schema: Schema, afterId: BlockId | null, types: readonly string[]): {
    parent: BlockId | null;
    index: number;
};
/** Whether blocks of `type` are part of their parent's layout (`parentTypes`). */
export declare function isStructural(schema: Schema, type: string): boolean;
/** Whether `block` may hold children now (its type always, or while a prop says so). */
export declare function acceptsChildren(schema: Schema, block: {
    type: string;
    props: Readonly<Record<string, unknown>>;
}): boolean;
/** Whether `block` folds its children away like a toggle (a toggle, a toggle heading). */
export declare function isToggle(schema: Schema, block: {
    type: string;
    props: Readonly<Record<string, unknown>>;
}): boolean;
//# sourceMappingURL=schema.d.ts.map