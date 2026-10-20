import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import TrashRoute from '../../../app/(app)/trash';
import type { Database } from '@/lib/types/databases';

const mockUpdateDatabase = jest.fn();
const mockDeleteDatabase = jest.fn();
let mockOwner = 'someone-else';
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'me' } }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/page-chrome', () => ({ IconDisplay: () => null }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn(async () => true) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
jest.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (select: (s: { currentWorkspaceId: string }) => unknown) =>
    select({ currentWorkspaceId: 'workspace' }),
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => ({ data: { ownerId: mockOwner } }),
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  useArchivedPages: () => ({ data: { pages: [] }, isLoading: false }),
  useDeletePage: () => ({ mutate: jest.fn() }),
  useEmptyTrash: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdatePage: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({
  useArchivedDatabases: () => ({
    data: [
      {
        id: 'db',
        workspaceId: 'workspace',
        name: 'Old tasks',
        icon: null,
        archived: true,
        updatedAt: '2026-10-01T00:00:00.000Z',
      } as Database,
    ],
  }),
  useUpdateDatabase: () => ({ mutate: mockUpdateDatabase }),
  useDeleteDatabase: () => ({ mutate: mockDeleteDatabase }),
}));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

function render() {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <TrashRoute />
      </BloomTestProviders>,
    );
  });
}
const button = (label: string) =>
  renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];

it('lists a database moved to the trash, and restores it', () => {
  render();
  expect(JSON.stringify(renderer.toJSON())).toContain('Old tasks');
  act(() => button('trash.restoreDatabase:Old tasks')?.props.onPress());
  expect(mockUpdateDatabase).toHaveBeenCalledWith({ id: 'db', archived: false }, expect.anything());
  // Deleting a database for good is the workspace owner's.
  expect(button('trash.deleteDatabasePermanently:Old tasks')).toBeUndefined();
});

it('deletes it for good for the workspace owner', async () => {
  mockOwner = 'me';
  render();
  await act(async () => button('trash.deleteDatabasePermanently:Old tasks')?.props.onPress());
  expect(mockDeleteDatabase).toHaveBeenCalledWith(
    { id: 'db', workspaceId: 'workspace', hard: true },
    expect.anything(),
  );
});
