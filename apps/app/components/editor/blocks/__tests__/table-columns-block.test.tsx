import {
  type Block as EditorBlock,
  type BlockSnapshot,
  documentFromSnapshot,
  EditorStore,
  getBlock,
} from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { NILO_SCHEMA, contentOf } from '@oxy.so/nilo-contracts/editor';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type { Block, BlockType } from '@/lib/types/pages';
import { TableBlock } from '../table-block';
import { ColumnsBlock } from '../columns-block';

// The cells and the columns' blocks are the editor's own rows; here, where each list goes.
jest.mock('@oxy.so/bloom-editor', () => {
  const { View: MockView } = require('react-native');
  return {
    ...jest.requireActual('@oxy.so/bloom-editor/model'),
    BlockList: ({ ids }: { ids: string[] }) => <MockView testID={`list:${ids.join(',')}`} />,
  };
});
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));

let n = 0;
const newId = () => `b${++n}`;
const cell = (text: string): BlockSnapshot => ({ type: 'table_cell', text: [{ text }] });
const asApiBlock = (block: EditorBlock): Block => ({
  id: block.id,
  pageId: 'page',
  parentBlockId: block.parent,
  type: block.type as BlockType,
  content: contentOf(block),
  order: 0,
  createdAt: '',
  updatedAt: '',
});

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));

function storeOf(snapshot: BlockSnapshot): EditorStore {
  return new EditorStore({
    document: documentFromSnapshot([snapshot], newId, NILO_SCHEMA),
    schema: NILO_SCHEMA,
    newId,
  });
}
const lists = () =>
  renderer.root
    .findAll(
      (node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('list:'),
    )
    .filter((node) => typeof node.type !== 'string')
    .map((node) => node.props.testID.slice('list:'.length) as string);

describe('a table in the editor', () => {
  const mount = (store: EditorStore, readOnly = false) => {
    const block = getBlock(store.doc, store.doc.root[0] as string);
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <TableBlock
            block={asApiBlock(block)}
            readOnly={readOnly}
            store={store}
            onChangeContent={jest.fn()}
          />
        </BloomTestProviders>,
      );
    });
  };
  const table = () =>
    storeOf({
      type: 'table',
      props: { rows: 2, cols: 2, withHeader: false },
      children: [
        { type: 'table_row', children: [cell('a'), cell('b')] },
        { type: 'table_row', children: [cell('c'), cell('d')] },
      ],
    });

  it('lays its cells out row by row, and adds a row and a column from its buttons', () => {
    const store = table();
    mount(store);
    expect(lists()).toHaveLength(4);
    act(() =>
      renderer.root
        .findByProps({ accessibilityLabel: 'editor.blocks.table.addRow' })
        .props.onPress(),
    );
    expect(lists()).toHaveLength(6);
    act(() =>
      renderer.root
        .findByProps({ accessibilityLabel: 'editor.blocks.table.addColumn' })
        .props.onPress(),
    );
    expect(lists()).toHaveLength(9);
    const tableBlock = getBlock(store.doc, store.doc.root[0] as string);
    expect(tableBlock.props).toMatchObject({ rows: 3, cols: 3 });
    // Each is its own undo step.
    act(() => {
      store.undo();
    });
    expect(lists()).toHaveLength(6);
  });

  it('tints the first row once it is a header', () => {
    const store = table();
    mount(store);
    const headers = () =>
      renderer.root.findAll(
        (node) => node.props.accessibilityRole === 'header' && typeof node.type !== 'string',
      );
    expect(headers()).toHaveLength(0);
    act(() => {
      store.run((c) => ({
        ops: [
          {
            kind: 'update',
            id: c.doc.root[0] as string,
            before: { props: getBlock(c.doc, c.doc.root[0] as string).props },
            after: {
              props: { ...getBlock(c.doc, c.doc.root[0] as string).props, withHeader: true },
            },
          },
        ],
      }));
    });
    expect(headers()).toHaveLength(1);
    expect(headers()[0]?.props.className).toContain('bg-muted');
  });

  it('offers a reader no controls', () => {
    mount(table(), true);
    expect(lists()).toHaveLength(4);
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'editor.blocks.table.addRow' }),
    ).toHaveLength(0);
  });
});

describe('columns in the editor', () => {
  const mount = (store: EditorStore) => {
    const block = getBlock(store.doc, store.doc.root[0] as string);
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <ColumnsBlock block={asApiBlock(block)} store={store} onChangeContent={jest.fn()} />
        </BloomTestProviders>,
      );
    });
  };

  it('draws each column as wide as its share, and lets an editor write in an empty one', () => {
    const store = storeOf({
      type: 'columns',
      props: { columnCount: 2 },
      children: [
        { type: 'column', props: { ratio: 0.25 }, children: [{ type: 'paragraph', text: [] }] },
        { type: 'column', props: { ratio: 0.75 }, children: [] },
      ],
    });
    mount(store);
    // A column is laid out with its share as its flex, and may shrink below its content.
    const flexes = renderer.root
      .findAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style))
      .filter((style) => style?.minWidth === 0 && typeof style.flex === 'number')
      .map((style) => style?.flex);
    expect(flexes).toEqual([0.25, 0.75]);
    expect(lists()).toHaveLength(1);
    act(() =>
      renderer.root
        .findByProps({ accessibilityLabel: 'editor.blocks.columns.empty' })
        .props.onPress(),
    );
    expect(lists()).toHaveLength(2);
  });
});
