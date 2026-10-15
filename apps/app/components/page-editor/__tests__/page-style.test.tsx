import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BlockEditor } from '@oxy.so/bloom-editor';
import { PageEditorProvider } from '../page-editor-context';
import { PageEditor } from '../page-editor';
import type { PageFont } from '@/lib/types/pages';

const mockStore = {};
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
jest.mock('@oxy.so/bloom-editor', () => ({
  BlockEditor: jest.fn(() => null),
  EditorToolbar: () => null,
  EditorController: class {},
  BlockDecorations: class {
    set() {}
  },
  blockColors: () => ({}),
}));
jest.mock('@oxy.so/bloom/theme', () => ({
  useTheme: () => mockTheme,
  resolveAccentColors: () => ({ background: 'blue' }),
}));
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ user: { id: 'owner' } }) }));
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
    <PageEditorProvider pageId="page" readOnly={false}>
      <PageEditor pageId="page" onOpenBlockComments={() => {}} />
    </PageEditorProvider>
  );
}
let renderer: ReactTestRenderer;
beforeEach(() => {
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
