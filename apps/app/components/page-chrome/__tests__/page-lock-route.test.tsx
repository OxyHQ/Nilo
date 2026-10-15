import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import PageDetailRoute from '@/app/(app)/p/[pageId]';
import { PageEditor } from '@/components/page-editor/page-editor';
import {
  PageEditorProvider,
  PageEditorToolbar,
} from '@/components/page-editor/page-editor-context';
import { RowPropertiesPanel } from '@/components/database/row-properties-panel';
import { CommentPanel } from '@/components/comments/comment-panel';
import { PageChrome } from '@/components/page-chrome';

let mockLocked = true;
let mockRole = 'editor';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ pageId: 'page' }),
  useRouter: () => ({}),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({
    data: {
      page: { id: 'page', workspaceId: 'workspace', databaseId: 'db', locked: mockLocked },
      role: mockRole,
    },
  }),
}));
jest.mock('@/lib/hooks/use-comments', () => ({ usePageComments: () => ({}) }));
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({ data: { database: { id: 'db' } } }),
}));
jest.mock('@/lib/hooks/use-track-recent-page', () => ({ useTrackRecentPage: jest.fn() }));
jest.mock('@/components/page-editor/page-editor', () => ({ PageEditor: jest.fn(() => null) }));
jest.mock('@/components/page-editor/page-editor-context', () => ({
  PageEditorProvider: ({ children }: { children: React.ReactNode }) => children,
  PageEditorToolbar: jest.fn(() => null),
  usePageEditorContext: () => ({ toolbarHeight: 0 }),
}));
jest.mock('@/components/page-chrome', () => ({
  PageChrome: ({ children }: { children: React.ReactNode }) => children,
  PageHeader: () => null,
}));
jest.mock('@/components/sharing', () => ({ ShareButton: () => null }));
jest.mock('@/components/comments/comment-panel', () => ({ CommentPanel: jest.fn(() => null) }));
jest.mock('@/components/database/row-properties-panel', () => ({
  RowPropertiesPanel: jest.fn(() => null),
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: require('react-native').View,
}));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
it.each(['editor', 'commenter', 'viewer'])(
  'honors the lock and preserves %s comment permissions',
  (role) => {
    mockLocked = true;
    mockRole = role;
    act(() => {
      renderer = create(<PageDetailRoute />);
    });
    expect(renderer.root.findByType(PageEditor).props.readOnly).toBe(true);
    expect(renderer.root.findByType(PageEditorProvider).props.readOnly).toBe(true);
    expect(renderer.root.findByType(PageEditorToolbar).props.readOnly).toBe(true);
    expect(renderer.root.findByType(RowPropertiesPanel).props.readOnly).toBe(true);
    expect(renderer.root.findByType(CommentPanel).props.canComment).toBe(role !== 'viewer');
    expect(renderer.root.findByType(PageChrome).props.readOnly).toBe(role !== 'editor');
  },
);
it('responds to remote unlock without remounting the page editor', () => {
  mockRole = 'editor';
  mockLocked = true;
  act(() => {
    renderer = create(<PageDetailRoute />);
  });
  const editor = renderer.root.findByType(PageEditor);
  mockLocked = false;
  act(() => renderer.update(<PageDetailRoute />));
  expect(renderer.root.findByType(PageEditor)).toBe(editor);
  expect(editor.props.readOnly).toBe(false);
  expect(renderer.root.findByType(RowPropertiesPanel).props.readOnly).toBe(false);
});
