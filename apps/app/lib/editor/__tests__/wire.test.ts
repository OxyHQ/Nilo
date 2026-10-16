import {
  backspaceAtStart,
  type CommandContext,
  documentToSnapshot,
  duplicateBlocks,
  type EditorDocument,
  EditorStore,
  getBlock,
  indent,
  insertBlockAfter,
  moveBlocks,
  outdent,
  removeBlocks,
  splitBlock,
  turnInto,
  validateDocument,
} from '@oxy.so/bloom-editor/model';
import { BLOCK_TYPES, normalizeContent } from '@oxy.so/nilo-contracts';
import type { Block } from '@/lib/types/pages';
import { NILO_SCHEMA } from '../schema';
import {
  blocksToDocument,
  contentOf,
  type OrderBook,
  reconcileOrder,
  transactionToWire,
  type WireOperation,
  wireToOperations,
} from '../wire';
import { FakeServer } from '../__fixtures__/fake-server';

const block = (id: string, order: number, overrides: Partial<Block> = {}): Block => ({
  id,
  pageId: 'p',
  parentBlockId: null,
  type: 'paragraph',
  content: { text: id, segments: [{ text: id }] },
  order,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('blocksToDocument', () => {
  it('nests by parent and orders siblings by order', () => {
    const { doc } = blocksToDocument([
      block('c', 2),
      block('a', 1),
      block('child', 1, { parentBlockId: 'a' }),
      block('todo', 3, { type: 'todo', content: { text: 'x', checked: true } }),
    ]);
    expect(validateDocument(doc)).toEqual([]);
    expect(doc.root).toEqual(['a', 'c', 'todo']);
    expect(getBlock(doc, 'a').children).toEqual(['child']);
    expect(getBlock(doc, 'todo')).toMatchObject({
      text: [{ text: 'x' }],
      props: { checked: true },
    });
  });

  it('keeps an orphan at the root instead of losing it', () => {
    const { doc } = blocksToDocument([block('lost', 1, { parentBlockId: 'gone' })]);
    expect(doc.root).toEqual(['lost']);
  });
});

describe('contentOf', () => {
  it('keeps a toggle heading a toggle through the API and back', () => {
    const { doc } = blocksToDocument([
      block('h', 0, {
        type: 'heading_2',
        content: { text: 'Plan', toggleable: true, expanded: false },
      }),
    ]);
    const heading = getBlock(doc, 'h');
    expect(heading.props).toMatchObject({ toggleable: true, expanded: false });
    expect(contentOf(heading)).toMatchObject({ text: 'Plan', toggleable: true, expanded: false });
  });

  it('round-trips page mentions in the canonical backlink segment shape', () => {
    const segment = {
      text: '@Target',
      mention: { indicator: '@' as const, attributes: { kind: 'page' as const, id: 'target' } },
    };
    const { doc } = blocksToDocument([
      block('source', 0, { content: { text: '@Target', segments: [segment] } }),
    ]);
    expect(contentOf(getBlock(doc, 'source')).segments).toEqual([segment]);
  });
  it('sends segments and the plain text, and plain text only for code', () => {
    expect(
      contentOf({ type: 'paragraph', text: [{ text: 'hi', bold: true }], props: { color: 'red' } }),
    ).toEqual({
      color: 'red',
      text: 'hi',
      segments: [{ text: 'hi', bold: true }],
    });
    expect(
      contentOf({ type: 'code', text: [{ text: 'x = 1' }], props: { language: 'js' } }),
    ).toEqual({
      language: 'js',
      text: 'x = 1',
    });
    expect(contentOf({ type: 'divider', props: {} })).toEqual({});
  });
});

/**
 * One editor applies a command; the server applies its wire form; another
 * editor applies what the server reports. All three must hold the same
 * document.
 */
let n = 0;
interface World {
  server: FakeServer;
  local: { doc: EditorDocument; orders: OrderBook };
  remote: { doc: EditorDocument; orders: OrderBook };
}

function world(blocks: Block[]): World {
  return {
    server: new FakeServer(blocks),
    local: blocksToDocument(blocks),
    remote: blocksToDocument(blocks),
  };
}

function step(w: World, command: (c: CommandContext) => ReturnType<typeof splitBlock>) {
  const local = new EditorStore({
    document: w.local.doc,
    schema: NILO_SCHEMA,
    newId: () => `0192f0c4-7d4e-7c2a-9b1e-${String(++n).padStart(12, '0')}`,
  });
  let wire: WireOperation[] = [];
  local.onTransaction((tx) => {
    wire = transactionToWire(tx, w.local.doc);
  });
  if (!local.run(command)) return null;
  const result = w.server.apply(wire);
  w.local.orders.recordApplied(result.ops, result.version);
  const remote = new EditorStore({
    document: w.remote.doc,
    schema: NILO_SCHEMA,
    newId: () => 'unused',
  });
  remote.dispatch(
    { ops: wireToOperations(remote.doc, result.ops, w.remote.orders, result.version) },
    'remote',
  );
  // The editor that made the change keeps the server's order too.
  const corrections = reconcileOrder(local.doc, w.local.orders);
  if (corrections.length > 0) local.dispatch({ ops: corrections }, 'remote');
  w.local.doc = local.doc;
  w.remote.doc = remote.doc;
  return { wire, applied: result.ops };
}

function expectSame(w: World) {
  const stored = documentToSnapshot(blocksToDocument(w.server.blocks).doc);
  expect(documentToSnapshot(w.local.doc)).toEqual(stored);
  expect(documentToSnapshot(w.remote.doc)).toEqual(stored);
}

describe('transactionToWire ⇄ server ⇄ wireToOperations', () => {
  const start = () =>
    world([
      block('a', 1),
      block('b', 2, { type: 'bulleted_list_item' }),
      block('c', 3, { type: 'toggle', content: { text: 'c', expanded: true } }),
      block('d', 1, { parentBlockId: 'c' }),
    ]);

  it('sends a split as an insert after its block, which the server orders', () => {
    const w = start();
    const result = step(w, (c) => splitBlock(c, 'a', 1));
    expect(result?.wire).toEqual([
      expect.objectContaining({ kind: 'insert', parentBlockId: null, afterId: 'a' }),
    ]);
    expect(result?.applied).toEqual([expect.objectContaining({ kind: 'insert', order: 1.5 })]);
    expectSame(w);
  });

  it('follows the server when it renumbers siblings', () => {
    const w = world([block('a', 1), block('b', 1 + 1e-12)]);
    const result = step(w, (c) => insertBlockAfter(c, 'a', 'paragraph'));
    expect(result?.applied.filter((op) => op.kind === 'reorder').length).toBeGreaterThan(0);
    expectSame(w);
  });

  it('replays random editing exactly on another client and on the server', () => {
    let seed = 3;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const w = start();
    for (let i = 0; i < 300; i += 1) {
      const ids = Object.keys(w.local.doc.blocks);
      if (ids.length === 0) break;
      const id = pick(ids);
      const target = pick(ids);
      step(
        w,
        pick([
          (c: CommandContext) => splitBlock(c, id, 1),
          (c: CommandContext) => backspaceAtStart(c, id),
          (c: CommandContext) => indent(c, id),
          (c: CommandContext) => outdent(c, id),
          (c: CommandContext) =>
            turnInto(c, id, pick(['paragraph', 'todo', 'heading_2', 'toggle'])),
          (c: CommandContext) => duplicateBlocks(c, [id]),
          (c: CommandContext) => (ids.length > 2 ? removeBlocks(c, [id]) : null),
          (c: CommandContext) =>
            moveBlocks(c, [id], target, pick(['before', 'after', 'inside'] as const)),
          (c: CommandContext) => insertBlockAfter(c, id, 'paragraph'),
        ]),
      );
      expect(validateDocument(w.remote.doc)).toEqual([]);
      expectSame(w);
    }
  });
});

describe('NILO_SCHEMA and the API contract', () => {
  it('gives every new block exactly the content the API would store', () => {
    for (const type of BLOCK_TYPES) {
      const store = new EditorStore({
        document: { root: [], blocks: {} },
        schema: NILO_SCHEMA,
        newId: () => 'b',
      });
      store.run((c) => insertBlockAfter(c, null, type));
      const content = contentOf(getBlock(store.doc, 'b'));
      expect([type, normalizeContent(type, content)]).toEqual([type, content]);
    }
  });

  it('drops what the API would drop when a block changes type', () => {
    const { doc } = blocksToDocument([
      block('t', 1, { type: 'todo', content: { text: 'x', checked: true } }),
    ]);
    const store = new EditorStore({ document: doc, schema: NILO_SCHEMA, newId: () => 'unused' });
    store.run((c) => turnInto(c, 't', 'paragraph'));
    const content = contentOf(getBlock(store.doc, 't'));
    expect(normalizeContent('paragraph', content)).toEqual(content);
  });
});
