import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DropdownMenuItem } from '@oxy.so/bloom/dropdown-menu';
import { confirm } from '@oxy.so/bloom/surfaces';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabaseActionsMenu } from '../database-actions-menu';
import type { Database } from '@/lib/types/databases';

let mockDatabase: Database;
let mockRole = 'editor';
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({ data: { database: mockDatabase, role: mockRole } }),
  useUpdateDatabase: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteDatabase: () => ({ mutateAsync: mockDelete, isPending: false }),
}));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useAddProperty: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteProperty: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/db/db',
}));
jest.mock('../database-chrome', () => ({ DatabaseChromePickers: () => null }));
jest.mock('@/lib/hooks/use-page-transfer', () => ({ useExportDatabase: () => ({}) }));
jest.mock('@/lib/save-export', () => ({ saveExport: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'editor';
  mockDatabase = {
    id: 'db',
    workspaceId: 'workspace',
    name: 'Tasks',
    locked: false,
    systemKey: null,
    cover: null,
    schema: { properties: [] },
  } as unknown as Database;
  mockDelete.mockResolvedValue(undefined);
});
afterEach(() => act(() => renderer.unmount()));

function mount() {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <DatabaseActionsMenu databaseId="db" />
      </BloomTestProviders>,
    );
  });
  // The items render once the menu is open.
  act(() => {
    renderer.root
      .findAll(
        (node) => node.props.accessibilityLabel === 'databases.csv.menu' && node.props.onPress,
      )[0]
      ?.props.onPress();
  });
}
const items = () =>
  renderer.root.findAllByType(DropdownMenuItem).map((node) => node.props.children as string);
const item = (label: string) =>
  renderer.root.findAllByType(DropdownMenuItem).find((node) => node.props.children === label);

it('locks and unlocks the database', () => {
  mount();
  act(() => item('databases.lock.lock')?.props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith({ id: 'db', locked: true }, expect.anything());
  act(() => renderer.unmount());
  mockDatabase = { ...mockDatabase, locked: true };
  mount();
  act(() => item('databases.lock.unlock')?.props.onPress());
  expect(mockUpdate).toHaveBeenLastCalledWith({ id: 'db', locked: false }, expect.anything());
  // Sub-items are a property: not added to a locked database.
  expect(item('databases.subItems.name')?.props.disabled).toBe(true);
});

it('moves the database to the trash once confirmed, and leaves its page', async () => {
  mount();
  expect(items()).not.toContain('databases.delete.hard');
  jest.mocked(confirm).mockResolvedValueOnce(false);
  await act(async () => item('databases.delete.trash')?.props.onPress());
  expect(mockDelete).not.toHaveBeenCalled();
  jest.mocked(confirm).mockResolvedValueOnce(true);
  await act(async () => item('databases.delete.trash')?.props.onPress());
  expect(mockDelete).toHaveBeenCalledWith({ id: 'db', workspaceId: 'workspace', hard: false });
  expect(mockReplace).toHaveBeenCalledWith('/(app)');
});

it('deletes it for good for its owner, and never an app’s database', async () => {
  mockRole = 'owner';
  mount();
  jest.mocked(confirm).mockResolvedValueOnce(true);
  await act(async () => item('databases.delete.hard')?.props.onPress());
  expect(mockDelete).toHaveBeenCalledWith({ id: 'db', workspaceId: 'workspace', hard: true });
  act(() => renderer.unmount());
  mockDatabase = { ...mockDatabase, systemKey: 'notes' };
  mount();
  expect(items()).not.toContain('databases.delete.trash');
  expect(items()).not.toContain('databases.delete.hard');
});
