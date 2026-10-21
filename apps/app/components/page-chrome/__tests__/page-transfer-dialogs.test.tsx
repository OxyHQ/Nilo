import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Button } from '@oxy.so/bloom/button';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type { Page } from '@/lib/types/pages';
import { ImportPagesDialog } from '../import-pages-dialog';
import { PageHistoryDialog } from '../page-history-dialog';

const mockPush = jest.fn();
const mockClose = jest.fn((callback?: () => void) => callback?.());
const mockRestore = jest.fn();
const mockImport = {
  data: undefined as unknown,
  error: null,
  reset: jest.fn(),
  mutateAsync: jest.fn(),
};
let mockRole = 'editor';
let mockPreviewError = false;
const mockVersions = Array.from({ length: 35 }, (_, index) => ({
  id: `v${index}`,
  createdBy: 'author',
  createdAt: '2026-10-20T10:00:00Z',
  blockCount: index + 1,
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/lib/hooks/use-page-transfer', () => ({ useImportPages: () => mockImport }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({ data: { role: mockRole }, isError: false }),
}));
jest.mock('@/lib/hooks/use-page-extras', () => ({
  usePageVersions: () => ({ data: { versions: mockVersions }, canEdit: mockRole === 'editor' }),
  usePageVersion: (_pageId: string, versionId: string) => ({
    data: { blocks: [{ id: versionId }] },
    isError: mockPreviewError,
  }),
  useRestoreVersion: () => ({ mutateAsync: mockRestore, isPending: false }),
}));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  useWorkspaceMembers: () => ({ data: [] }),
  memberProfileName: () => 'Author',
}));
jest.mock('@/components/sharing/shared-block-renderer', () => ({
  SharedBlockTree: ({ blocks }: { blocks: { id: string }[] }) => {
    const { Text } = require('react-native');
    return <Text testID="version-preview">{blocks[0].id}</Text>;
  },
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// Keep the owner boundary visible while native modal animation is outside this test.
// Product content still mounts real Bloom controls inside the dialog's one scroll region.
jest.mock('@oxy.so/bloom/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => {
    const { ScrollView } = require('react-native');
    return <ScrollView testID="dialog-scroll-owner">{children}</ScrollView>;
  },
  useDialogControl: () => ({ close: mockClose }),
}));
let renderer: ReactTestRenderer;
const page = { id: 'page', workspaceId: 'workspace', font: 'default', fullWidth: false } as Page;
async function mount(element: React.ReactNode) {
  await act(async () => {
    renderer = create(<BloomTestProviders>{element}</BloomTestProviders>);
  });
}
function dialog() {
  return renderer.root.findByType(Dialog);
}
function versionItems() {
  return renderer.root.findAll(
    (node) =>
      node.props.role === 'radio' &&
      typeof node.props.onPress === 'function' &&
      typeof node.props.title === 'string',
  );
}
function expectSingleOwner() {
  expect(dialog().props.scrollable).not.toBe(false);
  expect(dialog().findAllByType(ScrollView)).toHaveLength(1);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'editor';
  mockPreviewError = false;
  mockImport.data = undefined;
  mockRestore.mockResolvedValue(undefined);
});
afterEach(() => act(() => renderer?.unmount()));

it('keeps every skipped import path in the dialog flow and opens the imported page', async () => {
  const skipped = Array.from({ length: 60 }, (_, index) => `folder/skipped-${index}.bin`);
  mockImport.data = { pages: [{ id: 'imported' }], skipped };
  await mount(<ImportPagesDialog workspaceId="workspace" onClose={jest.fn()} />);
  expectSingleOwner();
  for (const path of skipped) expect(JSON.stringify(renderer.toJSON())).toContain(path);
  const open = renderer.root
    .findAllByType(Button)
    .find((node) => node.props.accessibilityRole === 'link');
  await act(async () => open?.props.onPress());
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/p/imported');
});

it('selects a distant version and restores only after confirmation', async () => {
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  expectSingleOwner();
  expect(versionItems()).toHaveLength(35);
  await act(async () => versionItems()[34].props.onPress());
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v34');
  await act(async () => dialog().props.actions[0].onPress());
  expect(mockRestore).not.toHaveBeenCalled();
  expect(dialog().props.dismissOnBackdrop).toBe(false);
  expect(versionItems()).toHaveLength(0);
  await act(async () => dialog().props.actions[0].onPress());
  expect(mockRestore).toHaveBeenCalledWith('v34');
  expectSingleOwner();
  expect(versionItems()).toHaveLength(35);
});

it.each(['viewer', 'commenter'])('does not render historical content for a %s', async (role) => {
  mockRole = role;
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  expect(renderer.root.findAllByType(Dialog)).toHaveLength(0);
  expect(versionItems()).toHaveLength(0);
  expect(mockRestore).not.toHaveBeenCalled();
});

it('does not offer restoration of a failed preview', async () => {
  mockPreviewError = true;
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  expectSingleOwner();
  expect(dialog().props.actions[0].disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.history.loadFailed');
  expect(mockRestore).not.toHaveBeenCalled();
});
