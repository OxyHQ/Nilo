import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EditorStore, removeBlocks } from '@oxy.so/bloom-editor/model';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { DatabasePicker } from '../database-picker';
import { SyncedBlockPicker } from '../synced-block-picker';
import apiClient from '@/lib/api/client';
import { syncedClipboard } from '@/lib/editor/synced-blocks';
import { toast } from '@oxy.so/bloom/toast';
import { BlockEditor } from '@oxy.so/bloom-editor';
import { PageEditorProvider } from '../page-editor-context';
import { isCommentShortcut, PageEditor } from '../page-editor';
import type { PageFont } from '@/lib/types/pages';

let mockStore: EditorStore;
const mockCollaborators: never[] = [];
const mockColors = {
  foreground: 'black',
  mutedForeground: 'gray',
  background: 'white',
  border: 'gray',
  primary: 'blue',
  primaryForeground: 'white',
  muted: 'gray',
};
const mockTheme = { colors: mockColors };
const mockT = (key: string) => key;
const mockMentions = {};
const mockOpenMention = jest.fn();
const mockCreateDatabase = jest.fn();
const mockDeleteDatabase = jest.fn();
const mockCreatePage = jest.fn();
const mockRouter = { push: jest.fn() };
let mockPage: { font: PageFont; smallText: boolean; fullWidth: boolean; workspaceId: string };
jest.mock('@/components/page-editor/page-canvas', () => ({ PageCanvas: () => null }));
jest.mock('@/lib/ai/use-ai', () => ({ useAiAvailable: () => false }));
jest.mock('../database-picker', () => ({ DatabasePicker: () => null }));
jest.mock('../synced-block-picker', () => ({ SyncedBlockPicker: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
const mockOpenComments = jest.fn();
jest.mock('@oxy.so/bloom-editor', () => ({
  ...jest.requireActual('@oxy.so/bloom-editor/model'),
  BlockEditor: jest.fn(() => null),
  EditorToolbar: () => null,
  EditorController: class {},
  BlockDecorations: class {
    set() {}
  },
  blockColors: () => ({}),
}));
jest.mock('@oxy.so/bloom/theme', () => ({
  ...jest.requireActual('@oxy.so/bloom/theme'),
  useTheme: () => mockTheme,
  resolveAccentColors: () => ({ background: 'blue' }),
}));
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('@oxy.so/bloom/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'owner' } }) }));
jest.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: mockColors, isDarkColorScheme: false }),
}));
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: mockT, locale: 'en' }) }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({ data: { page: mockPage } }),
  useCreatePage: () => ({ mutateAsync: mockCreatePage }),
}));
jest.mock('@/lib/hooks/use-comments', () => ({ usePageComments: () => ({ data: undefined }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/hooks/use-synced-blocks', () => ({
  useSyncedUsages: () => ({ data: undefined }),
}));
// Read when used: the factory runs before this file's constants are set.
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/components/page-chrome/icon-picker', () => ({ IconPicker: () => null }));
jest.mock('@/lib/hooks/use-databases', () => ({
  useCreateDatabase: () => ({ mutateAsync: mockCreateDatabase }),
  useDeleteDatabase: () => ({ mutate: mockDeleteDatabase }),
}));
jest.mock('@/lib/hooks/use-search-block', () => ({ useSearchBlock: jest.fn() }));
// Uploads and the clipboard are the extras' own; one stable object, as a memoised hook gives.
const mockExtras = {};
jest.mock('../editor-extras', () => ({ useEditorExtras: () => mockExtras }));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: () => ({}),
  profileName: jest.fn(),
}));
jest.mock('@/lib/editor/use-page-editor', () => ({
  usePageEditor: () => ({ store: mockStore, collaborators: mockCollaborators, status: 'saved' }),
}));
jest.mock('../use-editor-mentions', () => ({ useEditorMentions: () => mockMentions }));
jest.mock('../open-target', () => ({
  useOpenEditorMention: () => mockOpenMention,
  openEditorLink: jest.fn(),
}));
jest.mock('../renderers', () => ({ createRenderers: () => ({}), createMarkers: () => ({}) }));
jest.mock('../presence', () => ({
  collaboratorDecorations: () => new Map(),
  withCommentDecorations: () => new Map(),
  redrawOnChange: (_store: unknown, draw: () => void) => {
    draw();
    return () => {};
  },
}));
jest.mock('../presence-avatars', () => ({ PresenceAvatars: () => null }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: require('react-native').View,
}));

function Surface() {
  return (
    <BloomTestProviders>
      <PageEditorProvider pageId="page" readOnly={false}>
        <PageEditor pageId="page" onOpenBlockComments={mockOpenComments} />
      </PageEditorProvider>
    </BloomTestProviders>
  );
}
let renderer: ReactTestRenderer;
beforeEach(() => {
  mockStore = new EditorStore({
    document: {
      root: ['anchor'],
      blocks: {
        anchor: {
          id: 'anchor',
          type: 'paragraph',
          parent: null,
          children: [],
          props: {},
          text: [],
        },
      },
    },
    schema: NILO_SCHEMA,
    newId: () => 'new-block',
  });
  mockPage = { font: 'default', smallText: false, fullWidth: false, workspaceId: 'workspace' };
  act(() => {
    renderer = create(<Surface />);
  });
});
afterEach(() => act(() => renderer.unmount()));
it('keeps every BlockEditor prop stable when only width or query object identity changes', () => {
  const before = renderer.root.findByType(BlockEditor).props;
  mockPage = { ...mockPage, fullWidth: true };
  act(() => renderer.update(<Surface />));
  const after = renderer.root.findByType(BlockEditor).props;
  for (const key of Object.keys(before)) expect(after[key]).toBe(before[key]);
});
it('updates the theme in place for remotely changed typography and preserves the controller', () => {
  const editor = renderer.root.findByType(BlockEditor);
  const before = editor.props;
  mockPage = { ...mockPage, font: 'serif', smallText: true };
  act(() => renderer.update(<Surface />));
  const after = renderer.root.findByType(BlockEditor).props;
  expect(renderer.root.findByType(BlockEditor)).toBe(editor);
  expect(after.theme).toMatchObject({ fontFamily: 'BlomusModernus', textScale: 0.875 });
  expect(after.theme.colors).toBe(before.theme.colors);
  for (const key of Object.keys(before).filter((key) => key !== 'theme'))
    expect(after[key]).toBe(before[key]);
});

it('opens the linked database picker and inserts a block with its own id without creating a database', async () => {
  const before = renderer.root.findByType(BlockEditor).props;
  await act(async () => before.onSlashAction('linkedDatabase', 'anchor'));
  const picker = renderer.root.findByType(DatabasePicker);
  expect(picker.props.workspaceId).toBe('workspace');
  const opened = renderer.root.findByType(BlockEditor).props;
  for (const key of Object.keys(before)) expect(opened[key]).toBe(before[key]);
  act(() => picker.props.onChoose('source-database'));
  expect(mockStore.doc.blocks['new-block']).toMatchObject({
    id: 'new-block',
    type: 'inline_database',
    props: { databaseId: 'source-database' },
  });
  expect(mockStore.doc.blocks.anchor).toBeUndefined();
  expect(mockCreateDatabase).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(DatabasePicker)).toHaveLength(0);
});
it('makes a subpage of this page for a Page block, shows it here and opens it', async () => {
  const child = '01890000-0000-7000-8000-000000000001';
  mockCreatePage.mockResolvedValueOnce({ id: child, workspaceId: 'workspace' });
  await act(async () =>
    renderer.root.findByType(BlockEditor).props.onSlashAction('childPage', 'anchor'),
  );
  expect(mockCreatePage).toHaveBeenCalledWith({ workspaceId: 'workspace', parentId: 'page' });
  // The empty paragraph it was typed in gives way to the block.
  expect(mockStore.doc.root).toEqual(['new-block']);
  expect(mockStore.doc.blocks['new-block']).toMatchObject({
    type: 'child_page',
    props: { pageId: child },
  });
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(app)/p/[pageId]',
    params: { pageId: child },
  });
});
it('leaves the page as it is when the subpage cannot be made', async () => {
  mockCreatePage.mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    renderer.root.findByType(BlockEditor).props.onSlashAction('childPage', 'anchor'),
  );
  expect(mockStore.doc.root).toEqual(['anchor']);
});
it('cancels the picker without inserting a block', async () => {
  await act(async () =>
    renderer.root.findByType(BlockEditor).props.onSlashAction('linkedDatabase', 'anchor'),
  );
  act(() => renderer.root.findByType(DatabasePicker).props.onClose());
  expect(mockStore.doc.root).toEqual(['anchor']);
});

describe('synced blocks', () => {
  const action = (id: string) =>
    (
      renderer.root.findByType(BlockEditor).props.blockActions as {
        id: string;
        onPress: (b: string) => void;
      }[]
    ).find((a) => a.id === id);

  it('makes an original from the slash menu, with a paragraph to write in', async () => {
    // Two new blocks at once: ids of their own.
    let next = 0;
    mockStore = new EditorStore({
      document: mockStore.doc,
      schema: NILO_SCHEMA,
      newId: () => {
        next += 1;
        return `new-${next}`;
      },
    });
    act(() => renderer.update(<Surface />));
    await act(async () =>
      renderer.root.findByType(BlockEditor).props.onSlashAction('syncedBlock', 'anchor'),
    );
    const [original] = mockStore.doc.root;
    expect(mockStore.doc.blocks[original as string]).toMatchObject({
      type: 'sync_block',
      props: {},
    });
    const [child] = mockStore.doc.blocks[original as string]?.children ?? [];
    expect(mockStore.doc.blocks[child as string]?.type).toBe('paragraph');
  });

  it('pastes a reference chosen in the picker in place of the empty block', async () => {
    await act(async () =>
      renderer.root.findByType(BlockEditor).props.onSlashAction('pasteSyncedBlock', 'anchor'),
    );
    const picker = renderer.root.findByType(SyncedBlockPicker);
    expect(picker.props.workspaceId).toBe('workspace');
    act(() => picker.props.onChoose({ blockId: 'source-block', pageId: 'source-page' }));
    expect(mockStore.doc.root).toEqual(['new-block']);
    expect(mockStore.doc.blocks['new-block']).toMatchObject({
      type: 'sync_block',
      props: { sourceBlockId: 'source-block', sourcePageId: 'source-page' },
    });
    expect(renderer.root.findAllByType(SyncedBlockPicker)).toHaveLength(0);
  });

  it('copies and syncs a block: wrapped in an original kept for pasting', async () => {
    await act(async () => action('copySync')?.onPress('anchor'));
    const [original] = mockStore.doc.root;
    expect(mockStore.doc.blocks[original as string]?.children).toEqual(['anchor']);
    expect(syncedClipboard.get()).toEqual({ blockId: original, pageId: 'page' });
    expect(toast.success).toHaveBeenCalled();
  });

  it('warns that the pages showing a deleted original will show it deleted, with undo', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      data: {
        original: { blockId: 'x', page: { id: 'page' } },
        references: [
          { blockId: 'r1', page: { id: 'other' } },
          { blockId: 'r2', page: { id: 'page' } },
        ],
      },
    });
    await act(async () => action('copySync')?.onPress('anchor'));
    const [original] = mockStore.doc.root as [string];
    await act(async () => {
      mockStore.run((c) => removeBlocks(c, [original]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(apiClient.get).toHaveBeenCalledWith(`/blocks/${original}/synced`);
    expect(toast.warning).toHaveBeenCalledWith(
      'editor.blocks.syncBlock.deletedWarning',
      expect.objectContaining({
        action: expect.objectContaining({ onClick: expect.any(Function) }),
      }),
    );
    const { action: undo } = (toast.warning as jest.Mock).mock.calls[0][1];
    act(() => undo.onClick());
    expect(mockStore.doc.blocks[original]).toBeDefined();
  });
});

describe('comments on selected text', () => {
  it('comments from the block menu on the text selected in that block', () => {
    mockStore.run(() => ({
      ops: [
        {
          kind: 'update',
          id: 'anchor',
          before: { text: [] },
          after: { text: [{ text: 'Hello world' }] },
        },
      ],
      selectionAfter: { kind: 'text', blockId: 'anchor', start: 6, end: 11 },
    }));
    const comment = (
      renderer.root.findByType(BlockEditor).props.blockActions as {
        id: string;
        onPress: (b: string) => void;
      }[]
    ).find((a) => a.id === 'comment');
    act(() => comment?.onPress('anchor'));
    expect(mockOpenComments).toHaveBeenCalledWith('anchor', { start: 6, end: 11, quote: 'world' });
  });

  it('comments from the selection bubble and toolbar on the text selected', () => {
    mockStore.run(() => ({
      ops: [
        {
          kind: 'update',
          id: 'anchor',
          before: { text: [] },
          after: { text: [{ text: 'Hello world' }] },
        },
      ],
    }));
    const actions = renderer.root.findByType(BlockEditor).props.formatActions as {
      id: string;
      onPress: (selection: { blockId: string; start: number; end: number }) => void;
    }[];
    expect(actions.map((a) => a.id)).toEqual(['comment']);
    act(() => actions[0]?.onPress({ blockId: 'anchor', start: 0, end: 5 }));
    expect(mockOpenComments).toHaveBeenCalledWith('anchor', { start: 0, end: 5, quote: 'Hello' });
    // Nothing worth quoting: no comment.
    mockOpenComments.mockClear();
    act(() => actions[0]?.onPress({ blockId: 'anchor', start: 5, end: 6 }));
    expect(mockOpenComments).not.toHaveBeenCalled();
  });

  it('knows its shortcut', () => {
    const key = (init: Partial<KeyboardEvent>) =>
      ({
        key: 'm',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        ...init,
      }) as KeyboardEvent;
    expect(isCommentShortcut(key({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isCommentShortcut(key({ ctrlKey: true, shiftKey: true, key: 'M' }))).toBe(true);
    expect(isCommentShortcut(key({ metaKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
});
