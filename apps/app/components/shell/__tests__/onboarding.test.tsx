import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useOnboarding } from '../use-onboarding';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { useUIStore } from '@/lib/stores/ui-store';
import type { WorkspaceRole } from '@/lib/hooks/use-workspaces';

let mockRole: WorkspaceRole = 'editor';
let mockAuthenticated = true;
let mockPages: { ownerId: string; archived?: boolean; template?: boolean; databaseId?: string }[] =
  [];
const mockAsk = jest.fn();
const mockSettings = jest.fn();
const mockControl = { open: jest.fn(), close: jest.fn() };
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: mockAuthenticated, user: { id: 'me' } }),
}));
jest.mock('@alia.onl/sdk/avatar', () => ({ AliaAvatarIcon: () => null }));
jest.mock('@oxy.so/bloom/dialog', () => ({
  useDialogControl: () => mockControl,
  Dialog: () => null,
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({ useWorkspaceRole: () => mockRole }));
jest.mock('@/lib/hooks/use-pages', () => ({ usePages: () => ({ data: { pages: mockPages } }) }));
jest.mock('@/components/ask-alia', () => ({ useAskAlia: () => mockAsk }));
jest.mock('@/components/settings/settings-provider', () => ({
  useNiloSettings: () => ({ open: mockSettings }),
}));

let current: ReturnType<typeof useOnboarding>;
let renderer: ReactTestRenderer;
function Harness({ workspaceId = 'workspace' }: { workspaceId?: string | null }) {
  current = useOnboarding(workspaceId);
  return null;
}
beforeEach(() => {
  mockAuthenticated = true;
  mockRole = 'editor';
  mockPages = [];
  jest.clearAllMocks();
  useNewPageStore.getState().close();
  useUIStore.getState().setSidebarOpen(true);
  useUIStore.getState().setCommandPaletteOpen(false);
});
afterEach(() => act(() => renderer.unmount()));
function mount(workspaceId?: string | null) {
  act(() => {
    renderer = create(<Harness workspaceId={workspaceId} />);
  });
}

it('opens actual app flows and closes the mobile drawer', () => {
  mount();
  act(() => current.onboarding?.steps.find((step) => step.key === 'write')?.onPress?.());
  expect(useNewPageStore.getState().destination).toEqual({
    workspaceId: 'workspace',
    parentId: null,
  });
  expect(useUIStore.getState().sidebarOpen).toBe(false);
  act(() => current.onboarding?.steps.find((step) => step.key === 'ask')?.onPress?.());
  expect(mockAsk).toHaveBeenCalledTimes(1);
  act(() => current.onboarding?.steps.find((step) => step.key === 'search')?.onPress?.());
  expect(useUIStore.getState().commandPaletteOpen).toBe(true);
});

it('uses owned, active pages for progress rather than marking a click complete', () => {
  mockPages = [
    { ownerId: 'someone-else' },
    { ownerId: 'me', archived: true },
    { ownerId: 'me', databaseId: 'db' },
  ];
  mount();
  const write = () => current.onboarding?.steps.find((step) => step.key === 'write');
  act(() => write()?.onPress?.());
  expect(write()?.completed).toBe(false);
  mockPages = [{ ownerId: 'me' }];
  act(() => renderer.update(<Harness />));
  expect(write()?.completed).toBe(true);
});

it('offers only actions allowed by the member role', () => {
  mockRole = 'viewer';
  mount();
  expect(current.onboarding?.steps.map((step) => step.key)).toEqual(['ask', 'search']);
  mockRole = 'admin';
  act(() => renderer.update(<Harness />));
  act(() => current.onboarding?.steps.find((step) => step.key === 'invite')?.onPress?.());
  expect(mockSettings).toHaveBeenCalledWith('members');
});

it('opens the full guide and hides onboarding outside an authenticated workspace', () => {
  mount();
  act(() => current.onboarding?.onSeeAll?.());
  expect(mockControl.open).toHaveBeenCalledTimes(1);
  mockAuthenticated = false;
  act(() => renderer.update(<Harness />));
  expect(current.onboarding).toBeUndefined();
  expect(current.dialogs).toBeNull();
  mockAuthenticated = true;
  act(() => renderer.update(<Harness workspaceId={null} />));
  expect(current.onboarding).toBeUndefined();
});
