import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DetailDialog } from '@oxy.so/bloom/dialog';
import { PageHeaderTitleInput } from '@oxy.so/bloom/page-header';
import { Button } from '@oxy.so/bloom/button';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PageEditor } from '@/components/page-editor/page-editor';
import type { Page } from '@/lib/types/pages';
import { RowPeek } from '../row-peek';

const mockUpdate = jest.fn();
const mockPage = {
  data: {
    page: { id: 'row', databaseId: 'db', title: 'Plan', mode: 'document', locked: false } as Page,
    role: 'owner',
  },
  isLoading: false,
};
// Font assets are an Expo runtime concern, independent of detail permissions.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));
jest.mock('@/lib/hooks/use-pages', () => ({ usePage: () => mockPage }));
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({ data: { database: { id: 'db', name: 'Projects' } } }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useUpdateRow: () => ({ mutate: mockUpdate }),
  pageToDatabaseRow: (page: Page) => page,
}));
jest.mock('../row-properties-panel', () => ({ RowPropertiesPanel: () => null }));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('@/components/page-editor/page-editor', () => ({ PageEditor: () => null }));
jest.mock('@/components/page-editor/page-editor-context', () => ({
  PageEditorProvider: ({ children }: { children: React.ReactNode }) => children,
  PageEditorToolbar: () => null,
}));
// Bloom owns the modal/scroll rendering; exercise Nilo's live permissions and actions.
jest.mock('@oxy.so/bloom/dialog', () => ({
  ...jest.requireActual('@oxy.so/bloom/dialog'),
  DetailDialog: ({ header, actions, children, footer }: Record<string, React.ReactNode>) => (
    <>
      {header}
      {actions}
      {children}
      {footer}
    </>
  ),
}));
let renderer: ReactTestRenderer;
const openFullPage = jest.fn();
const close = jest.fn();
const tree = (mode: 'side' | 'center' = 'side') => (
  <BloomTestProviders>
    <RowPeek rowId="row" open mode={mode} onClose={close} onOpenFullPage={openFullPage} />
  </BloomTestProviders>
);
beforeEach(() => {
  mockPage.data.role = 'owner';
  mockPage.data.page = {
    id: 'row',
    databaseId: 'db',
    title: 'Plan',
    mode: 'document',
    locked: false,
  } as Page;
  jest.clearAllMocks();
});
afterEach(() => act(() => renderer?.unmount()));
const mount = (mode?: 'side' | 'center') =>
  act(async () => {
    renderer = create(tree(mode));
  });
const title = () => renderer.root.findByType(PageHeaderTitleInput);

it('keeps row title persistence and full-page navigation in the shared detail', async () => {
  await mount('center');
  expect(renderer.root.findByType(DetailDialog).props.mode).toBe('center');
  act(() => title().props.onChangeText('Updated plan'));
  act(() => title().props.onBlur());
  expect(mockUpdate).toHaveBeenCalledWith({
    databaseId: 'db',
    rowId: 'row',
    title: 'Updated plan',
  });
  act(() => renderer.root.findByType(Button).props.onPress());
  expect(openFullPage).toHaveBeenCalledTimes(1);
});

it('does not persist a pending title after access becomes read-only', async () => {
  await mount();
  act(() => title().props.onChangeText('Pending title'));
  mockPage.data.role = 'viewer';
  act(() => renderer.update(tree()));
  expect(title().props.editable).toBe(false);
  expect(renderer.root.findByType(PageEditor).props.readOnly).toBe(true);
  act(() => title().props.onBlur());
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('keeps a locked canvas read-only inside its bounded detail body', async () => {
  mockPage.data.page = { ...mockPage.data.page, mode: 'canvas', locked: true };
  await mount();
  const detail = renderer.root.findByType(DetailDialog);
  expect(detail.props.contentKind).toBe('canvas');
  expect(detail.props.scrollable).toBe(false);
  expect(title().props.editable).toBe(false);
  expect(renderer.root.findByType(PageEditor).props.readOnly).toBe(true);
  expect(detail.props.footer).toBeTruthy();
  expect(detail.props.footerKeyboardBehavior).toBe('follow');
});
