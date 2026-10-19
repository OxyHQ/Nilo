/**
 * Block types and the shape of each type's content.
 *
 * The API normalizes every block write through `normalizeContent`; the app's
 * editor derives each type's default and allowed props from the same
 * schemas, so what an editor holds is exactly what the server stores.
 */
import { z } from 'zod';
import { isEntityId } from './ids';

export const BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'todo',
  'quote',
  'divider',
  'code',
  'callout',
  'toggle',
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'bookmark',
  'embed',
  'columns',
  'column',
  'canvas_note',
  'table',
  'table_row',
  'table_cell',
  'button',
  'link_to_page',
  'child_page',
  'sync_block',
  'breadcrumb',
  'table_of_contents',
  'equation',
  'mermaid',
  'inline_database',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/** A block's content bag; each type's shape is its schema below. */
export type BlockContent = Record<string, unknown>;

export const blockTypeSchema = z.enum(BLOCK_TYPES);

const entityIdSchema = z.string().refine(isEntityId, 'Invalid id');

/**
 * The id a content payload carries when the UI has not chosen a target yet —
 * `link_to_page` before a page is picked, `child_page` before its page exists, `inline_database` between the block
 * being created and its database existing.
 *
 * It survives the move off ObjectIds unchanged because it is a well-formed
 * ObjectId hex that names no row, which is exactly what it has to be: a
 * sentinel the id validator accepts and no lookup ever resolves. Changing its
 * shape would be a wire-format change for the two block types that read it.
 */
const UNRESOLVED_TARGET_ID = '000000000000000000000000';

/**
 * Notion-style named colours a block or a rich-text segment may carry.
 *
 * Declared here rather than in `db/schema/pages.ts`: `blocks.content` is jsonb
 * the table validates nothing about, and this route is the only thing that has
 * ever validated its shape. The `BlockColor` union that used to sit beside this
 * array is gone — `z.enum` derives the type from the array, so the two cannot
 * drift.
 */
export const BLOCK_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;

const blockColorSchema = z.enum(BLOCK_COLORS);

/**
 * Rich-text segment — single run of text plus optional annotations.
 * Editors that don't read `segments` keep working against `text`; both stay
 * in sync at the route boundary (see `syncSegmentsAndText`).
 */
/**
 * Link targets a reader may follow. Anything else (`javascript:`, `data:`) is
 * rejected: page text is rendered as links in every reader's browser.
 */
export const SAFE_LINK = /^(https?:|mailto:|tel:|\/|#)/i;

/** Whether a page may load or link to `url`: what `SAFE_LINK` accepts. */
export function isSafeUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && SAFE_LINK.test(url.trim());
}

/**
 * A URL a block loads or links to. One that is not safe (`javascript:`,
 * `data:`…) is kept as none rather than refused, so a page holding one still
 * projects and the block reads as empty.
 */
const urlField = z.string().transform((url) => (isSafeUrl(url) ? url.trim() : ''));

const mentionSchema = z.object({
  indicator: z.string().min(1).max(4),
  attributes: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/i), z.string().max(512)),
});

export const segmentSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
  color: blockColorSchema.optional(),
  background: blockColorSchema.optional(),
  link: z
    .string()
    .max(2048)
    .refine((href) => SAFE_LINK.test(href.trim()), 'Unsafe link')
    .optional(),
  mention: mentionSchema.optional(),
});

/**
 * Common optional block-level styling fields. Kept on every content variant
 * so client code can read `content.color` uniformly.
 */
const styleFields = {
  color: blockColorSchema.optional(),
  backgroundColor: blockColorSchema.optional(),
} as const;

/**
 * Per-type content schemas with defaults. Concretely typed so each
 * `.parse()` returns the exact `BlockContent` variant without casts.
 *
 * Defaults are applied via Zod (`.default()`) so missing keys are filled
 * before validation and the output types remain non-optional strings/bools.
 */
const textContentSchema = z.object({
  text: z.string().default(''),
  segments: z.array(segmentSchema).optional(),
  ...styleFields,
});
/** A heading may be a toggle (Notion's toggle heading): it then folds what is under it. */
const headingContentSchema = textContentSchema.extend({
  toggleable: z.boolean().optional(),
  expanded: z.boolean().optional(),
});
const todoContentSchema = z.object({
  text: z.string().default(''),
  segments: z.array(segmentSchema).optional(),
  checked: z.boolean().default(false),
  ...styleFields,
});
const codeContentSchema = z.object({
  text: z.string().default(''),
  language: z.string().default('plain'),
  ...styleFields,
});
const calloutContentSchema = z.object({
  text: z.string().default(''),
  segments: z.array(segmentSchema).optional(),
  // Encoded like a page icon (`emoji:…`, `icon:<lucide name>`, `image:…`).
  icon: z.string().default('icon:lightbulb'),
  ...styleFields,
});
const toggleContentSchema = z.object({
  text: z.string().default(''),
  segments: z.array(segmentSchema).optional(),
  expanded: z.boolean().default(true),
  ...styleFields,
});
const dividerContentSchema = z.object(styleFields);

// --- Phase 3: media blocks ---
const imageAlignmentSchema = z.enum(['left', 'center', 'right', 'full']);
// `fileId`: an attachment in Oxy's file manager (`files.ts`); `url` then stays
// empty. A block without it points at the URL someone pasted.
const imageContentSchema = z.object({
  url: urlField.default(''),
  fileId: z.string().optional(),
  caption: z.string().optional(),
  alt: z.string().optional(),
  width: z.number().finite().positive().optional(),
  alignment: imageAlignmentSchema.optional(),
  ...styleFields,
});

const videoSourceSchema = z.enum(['upload', 'youtube', 'vimeo', 'loom', 'other']);
// An uploaded video or audio holds its attachment's id (`fileId`, as an image
// does) and is played from a URL minted for each reader; `url` stays empty.
const videoContentSchema = z.object({
  url: urlField.default(''),
  fileId: z.string().optional(),
  name: z.string().optional(),
  source: videoSourceSchema.default('other'),
  caption: z.string().optional(),
  ...styleFields,
});

const audioContentSchema = z.object({
  url: urlField.default(''),
  fileId: z.string().optional(),
  name: z.string().optional(),
  caption: z.string().optional(),
  ...styleFields,
});

const fileContentSchema = z.object({
  url: urlField.default(''),
  fileId: z.string().optional(),
  name: z.string().default(''),
  size: z.number().int().nonnegative().default(0),
  mimeType: z.string().default('application/octet-stream'),
  ...styleFields,
});

const pdfContentSchema = z.object({
  url: urlField.default(''),
  ...styleFields,
});

// --- Phase 3: embeds ---
const bookmarkContentSchema = z.object({
  url: urlField.default(''),
  title: z.string().optional(),
  description: z.string().optional(),
  image: urlField.optional(),
  favicon: urlField.optional(),
  ...styleFields,
});

const embedContentSchema = z.object({
  url: urlField.default(''),
  source: z.string().optional(),
  ...styleFields,
});

// --- Phase 3: layout ---
const columnsContentSchema = z.object({
  columnCount: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
  ...styleFields,
});

const columnContentSchema = z.object({
  /** Optional 0..1 fractional ratio. Defaults to even split when unset. */
  ratio: z.number().min(0).max(1).optional(),
  ...styleFields,
});

/**
 * A note on a canvas page: its blocks are its children, and it sits at `x`,
 * `y` (the canvas's own units, which may be negative) with a `width`.
 */
const canvasNoteContentSchema = z.object({
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  width: z.number().finite().min(160).max(2400).default(360),
  ...styleFields,
});

const tableContentSchema = z.object({
  rows: z.number().int().positive().default(2),
  cols: z.number().int().positive().default(2),
  withHeader: z.boolean().default(false),
  ...styleFields,
});

const tableRowContentSchema = z.object(styleFields);

const tableCellContentSchema = z.object({
  text: z.string().default(''),
  segments: z.array(segmentSchema).optional(),
  ...styleFields,
});

// --- Phase 3: interactive ---
const buttonActionSchema = z.enum(['duplicate-template', 'new-page', 'navigate', 'webhook']);
const buttonContentSchema = z.object({
  label: z.string().default('Button'),
  action: buttonActionSchema.default('navigate'),
  /** Action-specific params kept loose — validated by callers when fired. */
  url: urlField.optional(),
  pageId: entityIdSchema.optional(),
  templateId: entityIdSchema.optional(),
  webhookUrl: urlField.optional(),
  ...styleFields,
});

const linkToPageContentSchema = z.object({
  pageId: entityIdSchema.default(UNRESOLVED_TARGET_ID),
  ...styleFields,
});

/**
 * A subpage shown in its parent (Notion's "Page" block): the page it opens.
 * Removing the block leaves the page where it is, a subpage in the sidebar.
 */
const childPageContentSchema = z.object({
  pageId: entityIdSchema.default(UNRESOLVED_TARGET_ID),
  ...styleFields,
});

/**
 * A synced block. An original holds its content as its children; a reference
 * names the original (`sourceBlockId`) and the page it lives on
 * (`sourcePageId`) and shows that original's blocks, live, in its place.
 */
const syncBlockContentSchema = z.object({
  sourceBlockId: entityIdSchema.optional(),
  sourcePageId: entityIdSchema.optional(),
  ...styleFields,
});

const breadcrumbContentSchema = z.object(styleFields);
const tableOfContentsContentSchema = z.object(styleFields);

// --- Phase 3: math + diagram ---
const equationContentSchema = z.object({
  latex: z.string().default(''),
  ...styleFields,
});

const mermaidContentSchema = z.object({
  code: z.string().default(''),
  ...styleFields,
});

// --- Phase 4: database ---
const inlineDatabaseContentSchema = z.object({
  /**
   * The database to render — a `databases` row id. Defaults to
   * `UNRESOLVED_TARGET_ID` so the type-changed-to-inline_database path doesn't
   * fail validation; UI immediately replaces it after creating the DB.
   */
  databaseId: entityIdSchema.default(UNRESOLVED_TARGET_ID),
  /** Optional starting view; falls back to the database's default view. */
  viewId: entityIdSchema.optional(),
  ...styleFields,
});

/**
 * Keep plain `text` consistent with `segments`. When both are present, the
 * concatenated segment text wins (more expressive). When only `text` is
 * present, segments are left undefined so older readers keep working.
 *
 * Mutates and returns the same object — caller owns it (fresh from a Zod
 * parse), so this is safe and avoids spread-typing pain across heterogeneous
 * content variants.
 */
function syncTextFromSegments(value: BlockContent): BlockContent {
  const segments = value.segments;
  if (Array.isArray(segments) && segments.length > 0) {
    const flat = segments
      .map((s) =>
        s && typeof s === 'object' && 'text' in s
          ? String((s as { text: unknown }).text ?? '')
          : '',
      )
      .join('');
    value.text = flat;
  }
  return value;
}

/**
 * Normalize content by filling in type-specific defaults and validating shape.
 * Throws ZodError on validation failure (handled by the caller).
 *
 * Exported for `__tests__/blocks.phase3.test.ts`, which used to assert these
 * shapes against a hand-written COPY of the schemas below — so it measured the
 * copy, and went on passing when the copy and this file disagreed about what an
 * id looks like. It is the unit under test, not a seam invented for the test.
 */
export function normalizeContent(type: BlockType, content: unknown): BlockContent {
  const incoming =
    content && typeof content === 'object' && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};

  switch (type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return syncTextFromSegments(headingContentSchema.parse(incoming));
    case 'paragraph':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
      return syncTextFromSegments(textContentSchema.parse(incoming));
    case 'todo':
      return syncTextFromSegments(todoContentSchema.parse(incoming));
    case 'code':
      return codeContentSchema.parse(incoming);
    case 'callout':
      return syncTextFromSegments(calloutContentSchema.parse(incoming));
    case 'toggle':
      return syncTextFromSegments(toggleContentSchema.parse(incoming));
    case 'divider':
      return dividerContentSchema.parse(incoming);
    case 'image':
      return imageContentSchema.parse(incoming);
    case 'video':
      return videoContentSchema.parse(incoming);
    case 'audio':
      return audioContentSchema.parse(incoming);
    case 'file':
      return fileContentSchema.parse(incoming);
    case 'pdf':
      return pdfContentSchema.parse(incoming);
    case 'bookmark':
      return bookmarkContentSchema.parse(incoming);
    case 'embed':
      return embedContentSchema.parse(incoming);
    case 'columns':
      return columnsContentSchema.parse(incoming);
    case 'column':
      return columnContentSchema.parse(incoming);
    case 'canvas_note':
      return canvasNoteContentSchema.parse(incoming);
    case 'table':
      return tableContentSchema.parse(incoming);
    case 'table_row':
      return tableRowContentSchema.parse(incoming);
    case 'table_cell':
      return syncTextFromSegments(tableCellContentSchema.parse(incoming));
    case 'button':
      return buttonContentSchema.parse(incoming);
    case 'link_to_page':
      return linkToPageContentSchema.parse(incoming);
    case 'child_page':
      return childPageContentSchema.parse(incoming);
    case 'sync_block':
      return syncBlockContentSchema.parse(incoming);
    case 'breadcrumb':
      return breadcrumbContentSchema.parse(incoming);
    case 'table_of_contents':
      return tableOfContentsContentSchema.parse(incoming);
    case 'equation':
      return equationContentSchema.parse(incoming);
    case 'mermaid':
      return mermaidContentSchema.parse(incoming);
    case 'inline_database':
      return inlineDatabaseContentSchema.parse(incoming);
  }
}

/** Every type's content schema, for deriving defaults and allowed fields. */
function schemaFor(type: BlockType): z.AnyZodObject {
  switch (type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return headingContentSchema;
    case 'paragraph':
    case 'bulleted_list_item':
    case 'numbered_list_item':
    case 'quote':
      return textContentSchema;
    case 'todo':
      return todoContentSchema;
    case 'code':
      return codeContentSchema;
    case 'callout':
      return calloutContentSchema;
    case 'toggle':
      return toggleContentSchema;
    case 'divider':
      return dividerContentSchema;
    case 'image':
      return imageContentSchema;
    case 'video':
      return videoContentSchema;
    case 'audio':
      return audioContentSchema;
    case 'file':
      return fileContentSchema;
    case 'pdf':
      return pdfContentSchema;
    case 'bookmark':
      return bookmarkContentSchema;
    case 'embed':
      return embedContentSchema;
    case 'columns':
      return columnsContentSchema;
    case 'column':
      return columnContentSchema;
    case 'canvas_note':
      return canvasNoteContentSchema;
    case 'table':
      return tableContentSchema;
    case 'table_row':
      return tableRowContentSchema;
    case 'table_cell':
      return tableCellContentSchema;
    case 'button':
      return buttonContentSchema;
    case 'link_to_page':
      return linkToPageContentSchema;
    case 'child_page':
      return childPageContentSchema;
    case 'sync_block':
      return syncBlockContentSchema;
    case 'breadcrumb':
      return breadcrumbContentSchema;
    case 'table_of_contents':
      return tableOfContentsContentSchema;
    case 'equation':
      return equationContentSchema;
    case 'mermaid':
      return mermaidContentSchema;
    case 'inline_database':
      return inlineDatabaseContentSchema;
  }
}

/** The fields a type's content keeps; anything else is dropped on write. */
export function contentFields(type: BlockType): string[] {
  return Object.keys(schemaFor(type).shape);
}

/** The content a new block of `type` gets when nothing is given. */
export function defaultContent(type: BlockType): BlockContent {
  return normalizeContent(type, {});
}

export function isBlockType(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

/**
 * The original a synced block shows, or null for an original (or a block of
 * any other type). A reference needs both ids: the page is where its
 * original's document is read.
 */
export function syncedSource(
  type: string,
  content: BlockContent,
): { blockId: string; pageId: string } | null {
  if (type !== 'sync_block') return null;
  const { sourceBlockId, sourcePageId } = content as {
    sourceBlockId?: unknown;
    sourcePageId?: unknown;
  };
  return typeof sourceBlockId === 'string' && typeof sourcePageId === 'string'
    ? { blockId: sourceBlockId, pageId: sourcePageId }
    : null;
}
