// Activity's requests and interaction are covered by page-activity.test.tsx.
jest.mock('../page-activity', () => ({ PageActivity: () => null, PageActivityPanel: () => null }));
import { ShareButton } from '@/components/sharing';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type { PageHeaderProps } from '@oxy.so/bloom/page-header';
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
import { AppShellPanels } from '@oxy.so/bloom/app-shell';

let mockLocked = true;
let mockCompact = false;
jest.mock('@/lib/hooks/use-route-workspace', () => ({ useRouteWorkspace: jest.fn() }));
let mockRole = 'editor';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ pageId: 'page' }),
  useRouter: () => ({}),
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({
    data: {
      page: {
        id: 'page',
        workspaceId: 'workspace',
        databaseId: 'db',
        locked: mockLocked,
        archived: false,
      },
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
}));
jest.mock('@/components/page-chrome', () => ({
  PageChrome: ({
    children,
    bottomBar,
    rightHeader,
  }: {
    children: React.ReactNode;
    bottomBar: React.ReactNode;
    rightHeader: PageHeaderProps['actions'];
  }) => (
    <>
      {typeof rightHeader === 'function' ? rightHeader({ compact: mockCompact }) : rightHeader}
      {children}
      {bottomBar}
    </>
  ),
  PageHeader: () => null,
}));
// The route owns permissions and descriptors; Bloom tests layout and chrome.
jest.mock('@oxy.so/bloom/app-shell', () => ({
  AppShellPanels: ({
    layout,
  }: {
    layout: { panels: { id: string; content: React.ReactNode }[] };
  }) =>
    layout.panels.map((panel) =>
      require('react').createElement(
        require('react-native').View,
        { key: panel.id },
        panel.content,
      ),
    ),
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  ...jest.requireActual('@oxy.so/bloom/screen'),
  ScreenScrollView: require('react-native').View,
}));
jest.mock('@/components/sharing', () => ({ ShareButton: () => null }));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('@/components/comments/comment-panel', () => ({ CommentPanel: jest.fn(() => null) }));
jest.mock('@/components/database/row-properties-panel', () => ({
  RowPropertiesPanel: jest.fn(() => null),
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: require('react-native').View,
  KeyboardStickyView: require('react-native').View,
}));

let renderer: ReactTestRenderer;
beforeEach(() => {
  mockCompact = false;
});
function route() {
  return (
    <BloomTestProviders>
      <PageDetailRoute />
    </BloomTestProviders>
  );
}
afterEach(() => act(() => renderer.unmount()));
it.each(['editor', 'commenter', 'viewer'])(
  'honors the lock and preserves %s comment permissions',
  (role) => {
    mockLocked = true;
    mockRole = role;
    act(() => {
      renderer = create(route());
    });
    expect(renderer.root.findByType(PageEditor).props.readOnly).toBe(true);
    expect(renderer.root.findByType(PageEditorProvider).props.readOnly).toBe(true);
    // The toolbar reads it from the provider.
    renderer.root.findByType(PageEditorToolbar);
    expect(renderer.root.findByType(RowPropertiesPanel).props.readOnly).toBe(true);
    expect(renderer.root.findByType(CommentPanel).props.canComment).toBe(role !== 'viewer');
    expect(renderer.root.findByType(PageChrome).props.readOnly).toBe(role !== 'editor');
  },
);
it('responds to remote unlock without remounting the page editor', () => {
  mockRole = 'editor';
  mockLocked = true;
  act(() => {
    renderer = create(route());
  });
  const editor = renderer.root.findByType(PageEditor);
  mockLocked = false;
  act(() => renderer.update(route()));
  expect(renderer.root.findByType(PageEditor)).toBe(editor);
  expect(editor.props.readOnly).toBe(false);
  expect(renderer.root.findByType(RowPropertiesPanel).props.readOnly).toBe(false);
});

it('opens comments through the panel compositor and keeps the document editor mounted', () => {
  mockRole = 'editor';
  mockLocked = false;
  act(() => {
    renderer = create(route());
  });
  const editor = renderer.root.findByType(PageEditor);
  const panels = () => renderer.root.findByType(AppShellPanels).props.layout.panels;
  expect(panels().find((panel: { id: string }) => panel.id === 'comments').visible).toBe(false);
  act(() => editor.props.onOpenBlockComments('paragraph', { start: 0, end: 4, quote: 'Text' }));
  const comments = panels().find((panel: { id: string }) => panel.id === 'comments');
  expect(comments.visible).toBe(true);
  expect(comments.floating.open).toBe(true);
  expect(renderer.root.findByType(CommentPanel).props.focusedBlockId).toBe('paragraph');
  expect(renderer.root.findByType(PageEditor)).toBe(editor);
  act(() => comments.floating.onOpenChange(false));
  expect(panels().find((panel: { id: string }) => panel.id === 'comments').visible).toBe(false);
  expect(renderer.root.findByType(PageEditor)).toBe(editor);
});

it('passes Bloom compact presentation to sharing while keeping the editor mounted', () => {
  mockRole = 'editor';
  mockLocked = false;
  act(() => {
    renderer = create(route());
  });
  const editor = renderer.root.findByType(PageEditor);
  const share = renderer.root.findByType(ShareButton);
  for (const compact of [true, false]) {
    mockCompact = compact;
    act(() => renderer.update(route()));
    expect(renderer.root.findByType(ShareButton)).toBe(share);
    expect(share.props.compact).toBe(compact);
    expect(share.props.pageId).toBe('page');
    expect(renderer.root.findByType(PageEditor)).toBe(editor);
  }
});
