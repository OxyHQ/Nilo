/**
 * Nilo's blocks in the editor's model (`@oxy.so/bloom-editor`), shared by the
 * app and the API so both read and write pages the same way.
 *
 * The API stores blocks flat: `parentBlockId`, an `order` among siblings and
 * a `content` bag (text as `segments` and plain `text`, plus the type's
 * fields). The editor holds a tree of blocks with `text` and `props`. A page's
 * truth is its `Y.Doc` (`@oxy.so/bloom-editor/yjs`); the API's block rows are
 * read from it (`documentToRows`), and a page that predates it is stored from
 * its rows once (`rowsToDocument`).
 */
import {
  type BlockSpec,
  DEFAULT_SCHEMA,
  defineSchema,
  type Block as EditorBlock,
  type EditorDocument,
  extendSchema,
  specOf,
} from '@oxy.so/bloom-editor/model';
import { type Segment, segmentsToPlainText } from '@oxy.so/bloom-text/model';
import { BLOCK_TYPES, type BlockContent, contentFields, defaultContent } from './blocks';
import { compareOrder } from './order';

/** How Nilo's own block types behave under the editor's commands. */
const BEHAVIOUR = extendSchema(DEFAULT_SCHEMA, [
  { type: 'image', hasText: false, canHaveChildren: false },
  { type: 'video', hasText: false, canHaveChildren: false },
  { type: 'audio', hasText: false, canHaveChildren: false },
  { type: 'file', hasText: false, canHaveChildren: false },
  { type: 'pdf', hasText: false, canHaveChildren: false },
  { type: 'bookmark', hasText: false, canHaveChildren: false },
  { type: 'embed', hasText: false, canHaveChildren: false },
  // Structure, as Notion keeps it: a table holds rows, a row holds cells, a
  // columns block holds columns, and none of them moves anywhere else.
  {
    type: 'columns',
    hasText: false,
    canHaveChildren: true,
    isContainer: true,
    childTypes: ['column'],
  },
  {
    type: 'column',
    hasText: false,
    canHaveChildren: true,
    isContainer: true,
    parentTypes: ['columns'],
    grow: true,
  },
  { type: 'canvas_note', hasText: false, canHaveChildren: true, isContainer: true },
  {
    type: 'table',
    hasText: false,
    canHaveChildren: true,
    isContainer: true,
    childTypes: ['table_row'],
  },
  {
    type: 'table_row',
    hasText: false,
    canHaveChildren: true,
    isContainer: true,
    childTypes: ['table_cell'],
    parentTypes: ['table'],
  },
  // Return is a line break: splitting a cell would put a block in its row.
  {
    type: 'table_cell',
    hasText: true,
    multiline: true,
    canHaveChildren: false,
    parentTypes: ['table_row'],
    grow: true,
  },
  { type: 'button', hasText: false, canHaveChildren: false },
  { type: 'link_to_page', hasText: false, canHaveChildren: false },
  { type: 'sync_block', hasText: false, canHaveChildren: false },
  { type: 'breadcrumb', hasText: false, canHaveChildren: false },
  { type: 'table_of_contents', hasText: false, canHaveChildren: false },
  { type: 'equation', hasText: false, canHaveChildren: false },
  { type: 'mermaid', hasText: false, canHaveChildren: false },
  { type: 'inline_database', hasText: false, canHaveChildren: false },
]);

/** Content fields the editor holds as the block's text, not as props. */
const TEXT_FIELDS = new Set(['text', 'segments']);

/**
 * A type's props as the API stores them: the defaults `normalizeContent`
 * fills in, and only the fields it keeps. An editor block then always equals
 * what the server would store for it.
 */
function fromContract(spec: BlockSpec, type: (typeof BLOCK_TYPES)[number]): BlockSpec {
  const defaults = Object.fromEntries(
    Object.entries(defaultContent(type)).filter(([key]) => !TEXT_FIELDS.has(key)),
  );
  return {
    ...spec,
    defaultProps: defaults,
    props: contentFields(type).filter((key) => !TEXT_FIELDS.has(key)),
  };
}

/** Every block type the API stores (`BLOCK_TYPES`), and nothing else. */
export const NILO_SCHEMA = defineSchema(
  BLOCK_TYPES.map((type) => fromContract(specOf(BEHAVIOUR, type), type)),
);

function hasText(type: string): boolean {
  return specOf(NILO_SCHEMA, type).hasText;
}

/** The editor's text and props for an API block's content. */
export function fieldsFromContent(
  type: string,
  content: object,
): { text?: Segment[]; props: Record<string, unknown> } {
  const { text, segments, ...props } = content as BlockContent & { segments?: Segment[] };
  if (!hasText(type)) return { props };
  const value =
    Array.isArray(segments) && segments.length > 0
      ? segments
      : typeof text === 'string' && text
        ? [{ text }]
        : [];
  return { text: value, props };
}

/** The API content for an editor block: its props, plus `segments` and plain `text`. */
export function contentOf(block: Pick<EditorBlock, 'type' | 'text' | 'props'>): BlockContent {
  const content: Record<string, unknown> = { ...block.props };
  if (hasText(block.type)) {
    const segments = block.text ?? [];
    content.text = segmentsToPlainText(segments);
    // Code blocks store plain text only.
    if (block.type !== 'code') content.segments = segments;
  }
  return content as BlockContent;
}

/** A block as the API stores it. */
export interface BlockRow {
  id: string;
  parentBlockId: string | null;
  type: string;
  content: BlockContent;
  order: number;
}

/** The editor document for the API's flat rows. A block whose parent is gone sits at the top. */
export function rowsToDocument(rows: readonly BlockRow[]): EditorDocument {
  const known = new Set(rows.map((row) => row.id));
  const parentOf = (row: BlockRow) =>
    row.parentBlockId && known.has(row.parentBlockId) ? row.parentBlockId : null;
  const byParent = new Map<string | null, BlockRow[]>();
  for (const row of rows) {
    const list = byParent.get(parentOf(row)) ?? [];
    list.push(row);
    byParent.set(parentOf(row), list);
  }
  const childIds = (parent: string | null) =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => compareOrder(a.order, a.id, b.order, b.id))
      .map((row) => row.id);
  const blocks: Record<string, EditorBlock> = {};
  for (const row of rows) {
    const { text, props } = fieldsFromContent(row.type, row.content);
    blocks[row.id] = {
      id: row.id,
      type: row.type,
      parent: parentOf(row),
      ...(text !== undefined && { text }),
      props,
      children: childIds(row.id),
    };
  }
  return { root: childIds(null), blocks };
}

/** The API's rows for an editor document: siblings numbered in their order. */
export function documentToRows(doc: EditorDocument): BlockRow[] {
  const rows: BlockRow[] = [];
  const visit = (parent: string | null, ids: readonly string[]) => {
    ids.forEach((id, index) => {
      const block = doc.blocks[id];
      if (!block) return;
      rows.push({
        id,
        parentBlockId: parent,
        type: block.type,
        content: contentOf(block),
        order: index + 1,
      });
      visit(id, block.children);
    });
  };
  visit(null, doc.root);
  return rows;
}
