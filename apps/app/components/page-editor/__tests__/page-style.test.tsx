import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EditorStore } from '@oxy.so/bloom-editor/model';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { DatabasePicker } from '../database-picker';
import { BlockEditor } from '@oxy.so/bloom-editor';
import { PageEditorProvider } from '../page-editor-context';
import { PageEditor } from '../page-editor';
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
let mockPage: { font: PageFont; smallText: boolean; fullWidth: boolean; workspaceId: string };
jest.mock('@/components/page-editor/page-canvas', () => ({ PageCanvas: () => null }));
jest.mock('@/lib/ai/use-ai', () => ({ useAiAvailable: () => false }));
jest.mock('../database-picker', () => ({ DatabasePicker: () => null }));
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
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'owner' } }) }));
jest.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: mockColors, isDarkColorScheme: false }),
}));
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: mockT, locale: 'en' }) }));
jest.mock('@/lib/hooks/use-pages', () => ({ usePage: () => ({ data: { page: mockPage } }) }));
jest.mock('@/lib/hooks/use-databases', () => ({
  useCreateDatabase: () => ({ mutateAsync: mockCreateDatabase }),
}));
jest.mock('@/lib/hooks/use-search-block', () => ({ useSearchBlock: jest.fn() }));
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
jest.mock('../presence', () => ({ collaboratorDecorations: () => new Map() }));
jest.mock('../presence-avatars', () => ({ PresenceAvatars: () => null }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: require('react-native').View,
}));

function Surface() {
  return (
    <BloomTestProviders>
      <PageEditorProvider pageId="page" readOnly={false}>
        <PageEditor pageId="page" onOpenBlockComments={() => {}} />
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
it('cancels the picker without inserting a block', async () => {
  await act(async () =>
    renderer.root.findByType(BlockEditor).props.onSlashAction('linkedDatabase', 'anchor'),
  );
  act(() => renderer.root.findByType(DatabasePicker).props.onClose());
  expect(mockStore.doc.root).toEqual(['anchor']);
});
