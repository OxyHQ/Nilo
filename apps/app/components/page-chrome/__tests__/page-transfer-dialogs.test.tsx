import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import { AppShellPanels } from '@oxy.so/bloom/app-shell';
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
let mockAlone = false;
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
  usePage: () => ({ data: { role: mockRole }, isError: false, fetchStatus: 'idle' }),
}));
jest.mock('@/lib/hooks/use-page-extras', () => ({
  usePageVersions: () => ({ data: { versions: mockVersions }, canEdit: mockRole === 'editor' }),
  usePageVersion: (_pageId: string, versionId: string) => ({
    data: { blocks: [{ id: versionId }] },
    isError: mockPreviewError,
  }),
  useRestoreVersion: () => ({ mutateAsync: mockRestore, isPending: false }),
}));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: () => ({ data: [] }),
  profileName: () => 'Author',
}));
jest.mock('@/components/sharing/shared-block-renderer', () => ({
  SharedBlockTree: ({ blocks }: { blocks: { id: string }[] }) => {
    const { Text } = require('react-native');
    return <Text testID="version-preview">{blocks[0].id}</Text>;
  },
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// The modal and panel geometry belong to Bloom. Keep independent scroll owners
// visible without requiring DOM geometry in the product-behavior renderer.
jest.mock('@oxy.so/bloom/dialog', () => ({
  Dialog: ({ children, scrollable }: { children: React.ReactNode; scrollable?: boolean }) => {
    const { ScrollView, View } = require('react-native');
    return scrollable === false ? (
      <View>{children}</View>
    ) : (
      <ScrollView testID="dialog-scroll-owner">{children}</ScrollView>
    );
  },
  useDialogControl: () => ({ close: mockClose }),
}));

jest.mock('@oxy.so/bloom/app-shell', () => ({
  AppShellPanels: ({ children }: { children: React.ReactNode }) => children,
  AppShellPanel: ({ children }: { children: React.ReactNode }) => children,
  useAppShellPanel: () => ({ alone: mockAlone, framed: false }),
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({
    header,
    children,
    bottomBar,
  }: {
    header: React.ReactNode;
    children: React.ReactNode;
    bottomBar?: React.ReactNode;
  }) => (
    <>
      {header}
      {children}
      {bottomBar}
    </>
  ),
  ScreenScrollView: ({ children, ...props }: { children: React.ReactNode }) => {
    const { ScrollView } = require('react-native');
    return <ScrollView {...props}>{children}</ScrollView>;
  },
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
      node.props.accessibilityHint === 'pages.history.preview' &&
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
  mockAlone = false;
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

function historyDialog() {
  return renderer.root.find(
    (node) => node.type === Dialog && node.props.presentation === 'fullscreen',
  );
}
function restoreAction() {
  return renderer.root.find(
    (node) => node.type === Button && node.props.children === 'pages.history.restore',
  );
}
function cancelRestore() {
  return renderer.root.find(
    (node) => node.type === Button && node.props.children === 'common.cancel',
  );
}
function beginRestore() {
  return renderer.root.find(
    (node) => node.type === Button && node.props.children === 'pages.history.beginRestore',
  );
}

it('selects a distant version in the composed preview and restores only after confirmation', async () => {
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  expect(historyDialog().props).toMatchObject({ scrollable: false, contentPadding: 0 });
  expect(renderer.root.findByType(AppShellPanels).props).toMatchObject({
    scope: 'local',
    appearance: 'plain',
    collapseBelow: 'md',
    show: 'versions',
  });
  expect(historyDialog().findAllByType(ScrollView)).toHaveLength(2);
  expect(versionItems()).toHaveLength(35);
  await act(async () => versionItems()[34].props.onPress());
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v34');
  expect(renderer.root.findByType(AppShellPanels).props.show).toBe('preview');
  await act(async () => beginRestore().props.onPress());
  expect(mockRestore).not.toHaveBeenCalled();
  // Confirming does not replace or erase the selected historical preview.
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v34');
  expect(versionItems()).toHaveLength(0);
  expect(renderer.root.findAllByType(Dialog)).toHaveLength(1);
  expect(historyDialog().props.dismissOnBackdrop).toBe(false);
  await act(async () => restoreAction().props.onPress());
  expect(mockRestore).toHaveBeenCalledWith('v34');
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('uses panel compact state for back navigation and a single close owner', async () => {
  mockAlone = true;
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  await act(async () => versionItems()[4].props.onPress());
  const back = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === 'pages.history.back' &&
      typeof node.props.onPress === 'function',
  )[0];
  if (!back) throw new Error('Missing accessible compact back action');
  await act(async () => back.props.onPress());
  expect(renderer.root.findByType(AppShellPanels).props.show).toBe('versions');
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v4');
  // Both panels remain in this geometry-free harness. Each supplies its own
  // close only when alone; on desktop only the preview supplies one.
  act(() => {
    mockAlone = false;
    renderer.update(
      <BloomTestProviders>
        <PageHistoryDialog page={page} onClose={jest.fn()} />
      </BloomTestProviders>,
    );
  });
  expect(
    renderer.root.findAll(
      (node) =>
        typeof node.type === 'string' && node.props.accessibilityLabel === 'pages.history.close',
    ),
  ).toHaveLength(1);
});

it('retains the selected preview after restore failure and retries without duplicate mutation', async () => {
  let reject!: (error: Error) => void;
  mockRestore.mockImplementationOnce(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  await act(async () => versionItems()[2].props.onPress());
  await act(async () => beginRestore().props.onPress());
  const submit = restoreAction().props.onPress;
  act(() => {
    submit();
    submit();
  });
  expect(mockRestore).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('transport failed')));
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.history.restoreFailed');
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v2');
  expect(mockClose).not.toHaveBeenCalled();
  await act(async () => restoreAction().props.onPress());
  expect(mockRestore).toHaveBeenCalledTimes(2);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

it('cancels confirmation without restoring or changing the selected version', async () => {
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  await act(async () => beginRestore().props.onPress());
  await act(async () => cancelRestore().props.onPress());
  expect(mockRestore).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(Dialog)).toHaveLength(1);
  expect(renderer.root.findByProps({ testID: 'version-preview' }).props.children).toBe('v0');
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
  expect(beginRestore().props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.history.loadFailed');
  expect(mockRestore).not.toHaveBeenCalled();
});

it('does not close another view or show feedback after an in-flight restore unmounts', async () => {
  let resolve!: () => void;
  mockRestore.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await mount(<PageHistoryDialog page={page} onClose={jest.fn()} />);
  await act(async () => beginRestore().props.onPress());
  act(() => restoreAction().props.onPress());
  act(() => renderer.unmount());
  await act(async () => resolve());
  expect(mockClose).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
