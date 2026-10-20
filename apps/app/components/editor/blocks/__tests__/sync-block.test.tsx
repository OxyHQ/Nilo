import {
  type Block as EditorBlock,
  type BlockSnapshot,
  documentFromSnapshot,
  EditorStore,
  getBlock,
} from '@oxy.so/bloom-editor/model';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text as RNText } from 'react-native';
import { NILO_SCHEMA, contentOf } from '@oxy.so/nilo-contracts/editor';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import {
  EmbeddedEditorProvider,
  type EmbeddedEditorValue,
} from '@/components/page-editor/embedded-editor';
import { newSyncedOriginal, syncedReference } from '@/lib/editor/synced-blocks';
import type { Block, BlockType } from '@/lib/types/pages';
import { SyncBlock } from '../sync-block';

// The original's blocks are the editor's own rows; here, which store and ids they are.
const mockSurfaces: {
  store: unknown;
  readOnly: boolean;
  slashItems: { id: string }[];
  domIdPrefix?: string;
}[] = [];
jest.mock('@oxy.so/bloom-editor', () => {
  const { View: MockView } = require('react-native');
  return {
    ...jest.requireActual('@oxy.so/bloom-editor/model'),
    BLOCK_DOM_PREFIX: 'bloom-block-',
    blockDomId: (id: string, prefix = 'bloom-block-') => `${prefix}${id}`,
    EditorController: class {
      ui = { get: () => ({ focused: null, linking: null }), subscribe: () => () => {} };
    },
    EditorSurface: (props: {
      store: unknown;
      readOnly: boolean;
      slashItems: { id: string }[];
      children: unknown;
    }) => {
      mockSurfaces.push(props);
      return props.children;
    },
    BlockList: ({ ids }: { ids: string[] }) => <MockView testID={`list:${ids.join(',')}`} />,
  };
});
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
// Links, pasted images and code highlighting have their own tests.
jest.mock('@/components/page-editor/editor-extras', () => ({
  useEditorExtras: () => ({}),
  blockLink: (pageId: string, blockId: string) => `/p/${pageId}?blockId=${blockId}`,
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

let mockUsages: { references: { blockId: string; page: { id: string } }[] } | undefined;
jest.mock('@/lib/hooks/use-synced-blocks', () => ({
  useSyncedUsages: () => ({ data: mockUsages }),
}));
let mockPage: { data?: unknown; isLoading?: boolean; isError?: boolean; error?: unknown };
jest.mock('@/lib/hooks/use-pages', () => ({ usePage: () => mockPage }));
let mockSource: { store: EditorStore | null; error: Error | null };
const mockOpened: { pageId: string; readOnly: boolean; embedded?: boolean }[] = [];
jest.mock('@/lib/editor/use-page-editor', () => ({
  usePageEditor: (pageId: string, readOnly: boolean, options: { embedded?: boolean }) => {
    mockOpened.push({ pageId, readOnly, embedded: options?.embedded });
    return { ...mockSource, status: 'saved', collaborators: [], rejected: null };
  },
}));

let n = 0;
const newId = () => `s${++n}`;
const para = (text: string): BlockSnapshot => ({ type: 'paragraph', text: [{ text }] });
const storeOf = (snapshot: BlockSnapshot[]) =>
  new EditorStore({
    document: documentFromSnapshot(snapshot, newId, NILO_SCHEMA),
    schema: NILO_SCHEMA,
    newId,
  });
const asApiBlock = (block: EditorBlock): Block => ({
  id: block.id,
  pageId: 'host',
  parentBlockId: block.parent,
  type: block.type as BlockType,
  content: contentOf(block),
  order: 0,
  createdAt: '',
  updatedAt: '',
});
const embedded: EmbeddedEditorValue = {
  slashItems: [
    { id: 'paragraph', label: 'P', group: 'basic', action: { kind: 'block', type: 'paragraph' } },
    { id: 'columns', label: 'C', group: 'advanced', action: { kind: 'custom', id: 'columns' } },
    { id: 'childPage', label: 'Page', group: 'basic', action: { kind: 'custom', id: 'childPage' } },
    {
      id: 'pasteSyncedBlock',
      label: 'Paste',
      group: 'advanced',
      action: { kind: 'custom', id: 'pasteSyncedBlock' },
    },
  ],
  markers: {},
  theme: {} as EmbeddedEditorValue['theme'],
  labels: {} as EmbeddedEditorValue['labels'],
  onOpenLink: jest.fn(),
  renderersFor: () => ({}),
  setActiveController: jest.fn(),
};

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
beforeEach(() => {
  mockSurfaces.length = 0;
  mockOpened.length = 0;
  mockUsages = undefined;
  mockPush.mockClear();
});

function mount(store: EditorStore, readOnly = false) {
  const block = getBlock(store.doc, store.doc.root[0] as string);
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <EmbeddedEditorProvider value={embedded}>
          <SyncBlock
            block={asApiBlock(block)}
            readOnly={readOnly}
            store={store}
            onChangeContent={jest.fn()}
            renderChildren={(id) => <RNText>{`children of ${id}`}</RNText>}
          />
        </EmbeddedEditorProvider>
      </BloomTestProviders>,
    );
  });
}
const texts = () =>
  renderer.root
    .findAll((node) => node.type === RNText || (node.type as unknown) === 'Text')
    .flatMap((node) => node.props.children)
    .filter((value) => typeof value === 'string')
    .join(' | ');
/** Press the control whose text is `label`. */
const press = (label: string) => {
  const text = renderer.root.findAll(
    (node) => typeof node.type === 'string' && node.props.children === label,
  )[0];
  let at = text?.parent ?? null;
  while (at && typeof at.props.onPress !== 'function') at = at.parent;
  if (!at) throw new Error(`nothing to press: ${label}`);
  const target = at;
  act(() => target.props.onPress());
};

describe('an original', () => {
  it('is its children, framed, with where else it is shown and a way to copy it', () => {
    const store = storeOf([{ ...newSyncedOriginal(), children: [para('Mine')] }]);
    mockUsages = {
      references: [
        { blockId: 'r1', page: { id: 'a' } },
        { blockId: 'r2', page: { id: 'a' } },
        { blockId: 'r3', page: { id: 'host' } },
      ],
    };
    mount(store);
    const original = store.doc.root[0] as string;
    expect(texts()).toContain(`children of ${original}`);
    // Two references on one other page: one page.
    expect(texts()).toContain('editor.blocks.syncBlock.shownOn {"count":1}');
    expect(texts()).toContain('editor.blocks.syncBlock.copy');
  });

  it('offers a block to write in when it is empty, to an editor only', () => {
    const store = storeOf([{ type: 'sync_block' }]);
    mount(store);
    press('editor.blocks.syncBlock.addBlock');
    const original = getBlock(store.doc, store.doc.root[0] as string);
    expect(original.children.map((id) => store.doc.blocks[id]?.type)).toEqual(['paragraph']);
    act(() => renderer.unmount());
    mount(storeOf([{ type: 'sync_block' }]), true);
    expect(texts()).toContain('editor.blocks.syncBlock.empty');
    expect(texts()).not.toContain('editor.blocks.syncBlock.copy');
  });
});

describe('a reference', () => {
  const source = storeOf([{ ...newSyncedOriginal(), children: [para('Shared'), para('Words')] }]);
  const originalId = source.doc.root[0] as string;
  const reference = () =>
    storeOf([para('Above'), syncedReference({ blockId: originalId, pageId: 'source' })]);
  const mountReference = (host: EditorStore, readOnly = false) => {
    const block = getBlock(host.doc, host.doc.root[1] as string);
    act(() => {
      renderer = create(
        <BloomTestProviders>
          <EmbeddedEditorProvider value={embedded}>
            <SyncBlock
              block={asApiBlock(block)}
              readOnly={readOnly}
              store={host}
              onChangeContent={jest.fn()}
            />
          </EmbeddedEditorProvider>
        </BloomTestProviders>,
      );
    });
  };

  it('shows its original’s blocks from the source page, editable in place by an editor', () => {
    mockPage = {
      data: { page: { title: 'Source', locked: false, archived: false }, role: 'editor' },
    };
    mockSource = { store: source, error: null };
    const host = reference();
    mountReference(host);
    expect(mockOpened.at(-1)).toEqual({ pageId: 'source', readOnly: false, embedded: true });
    const surface = mockSurfaces.at(-1);
    expect(surface?.store).toBe(source);
    expect(surface?.readOnly).toBe(false);
    // Its rows have ids of their own: the original's blocks may be on this page too.
    expect(surface?.domIdPrefix).toBe(`nilo-synced-${host.doc.root[1]}-`);
    // What needs the page around it is not offered inside a synced block.
    expect(surface?.slashItems.map((item) => item.id)).toEqual(['paragraph', 'columns']);
    const [first, second] = getBlock(source.doc, originalId).children;
    expect(
      renderer.root.findAll((node) => node.props.testID === `list:${first},${second}`).length,
    ).toBeGreaterThan(0);
    expect(texts()).toContain('editor.blocks.syncBlock.from {"title":"Source"}');
    press('editor.blocks.syncBlock.editOriginal');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/p/[pageId]',
      params: { pageId: 'source', blockId: originalId },
    });
  });

  it('is read only to someone who may only read the source, or on a page they only read', () => {
    mockPage = {
      data: { page: { title: 'Source', locked: false, archived: false }, role: 'viewer' },
    };
    mockSource = { store: source, error: null };
    mountReference(reference());
    expect(mockOpened.at(-1)?.readOnly).toBe(true);
    expect(mockSurfaces.at(-1)?.readOnly).toBe(true);
    act(() => renderer.unmount());
    mockPage = {
      data: { page: { title: 'Source', locked: false, archived: false }, role: 'editor' },
    };
    mountReference(reference(), true);
    expect(mockSurfaces.at(-1)?.readOnly).toBe(true);
    expect(texts()).not.toContain('editor.blocks.syncBlock.unsync');
  });

  it('unsyncs into a copy of the original’s blocks', () => {
    mockPage = {
      data: { page: { title: 'Source', locked: false, archived: false }, role: 'editor' },
    };
    mockSource = { store: source, error: null };
    const host = reference();
    mountReference(host);
    press('editor.blocks.syncBlock.unsync');
    expect(host.doc.root.map((id) => host.doc.blocks[id]?.text?.[0]?.text)).toEqual([
      'Above',
      'Shared',
      'Words',
    ]);
  });

  it('says the original was deleted, and can be removed', () => {
    mockPage = {
      data: { page: { title: 'Source', locked: false, archived: false }, role: 'editor' },
    };
    mockSource = { store: storeOf([para('Nothing synced here')]), error: null };
    const host = reference();
    mountReference(host);
    expect(texts()).toContain('editor.blocks.syncBlock.deleted');
    press('editor.blocks.syncBlock.remove');
    expect(host.doc.root).toHaveLength(1);
  });

  it('says so when the source page is gone or shut to the reader', () => {
    mockPage = { isError: true, error: { isAxiosError: true, response: { status: 404 } } };
    mountReference(reference());
    expect(texts()).toContain('editor.blocks.syncBlock.deleted');
    act(() => renderer.unmount());
    mockPage = { isError: true, error: { isAxiosError: true, response: { status: 403 } } };
    mountReference(reference());
    expect(texts()).toContain('editor.blocks.syncBlock.noAccess');
    // Nothing of the source page was opened.
    expect(mockOpened).toHaveLength(0);
  });
});
