import { BLOCK_TYPES, contentFields, defaultContent } from '@oxy.so/nilo-contracts';
import {
  type BlockSpec,
  DEFAULT_SCHEMA,
  defineSchema,
  extendSchema,
  specOf,
} from '@oxy.so/bloom-editor/model';

/** How Nilo's own block types behave under the editor's commands. */
const BEHAVIOUR = extendSchema(DEFAULT_SCHEMA, [
  { type: 'image', hasText: false, canHaveChildren: false },
  { type: 'video', hasText: false, canHaveChildren: false },
  { type: 'audio', hasText: false, canHaveChildren: false },
  { type: 'file', hasText: false, canHaveChildren: false },
  { type: 'pdf', hasText: false, canHaveChildren: false },
  { type: 'bookmark', hasText: false, canHaveChildren: false },
  { type: 'embed', hasText: false, canHaveChildren: false },
  { type: 'columns', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'column', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'canvas_note', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table_row', hasText: false, canHaveChildren: true, isContainer: true },
  { type: 'table_cell', hasText: true, canHaveChildren: false },
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

/** Every block type the API stores (`@oxy.so/nilo-contracts` `BLOCK_TYPES`), and nothing else. */
export const NILO_SCHEMA = defineSchema(
  BLOCK_TYPES.map((type) => fromContract(specOf(BEHAVIOUR, type), type)),
);
