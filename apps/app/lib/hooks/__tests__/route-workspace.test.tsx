import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useRouteWorkspace } from '../use-route-workspace';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

let mockWorkspaces: { id: string }[] | undefined;
jest.mock('../use-workspaces', () => ({
  useWorkspaces: () => ({ data: mockWorkspaces }),
}));

function Route({ workspaceId }: { workspaceId?: string }) {
  useRouteWorkspace(workspaceId);
  return null;
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  mockWorkspaces = [{ id: 'personal' }, { id: 'team' }];
  useWorkspaceStore.setState({ currentWorkspaceId: 'personal' });
});
afterEach(() => act(() => renderer.unmount()));

it('selects the workspace of a member deep link', () => {
  act(() => {
    renderer = create(<Route workspaceId="team" />);
  });
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('team');
});

it('keeps the existing workspace for a shared guest page', () => {
  act(() => {
    renderer = create(<Route workspaceId="guest-workspace" />);
  });
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('personal');
});

it('waits for membership and follows a new route', () => {
  mockWorkspaces = undefined;
  act(() => {
    renderer = create(<Route workspaceId="team" />);
  });
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('personal');
  mockWorkspaces = [{ id: 'personal' }, { id: 'team' }];
  act(() => renderer.update(<Route workspaceId="team" />));
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('team');
  act(() => renderer.update(<Route workspaceId="personal" />));
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('personal');
});

it('does not undo a deliberate switch while navigation leaves the old route', () => {
  act(() => {
    renderer = create(<Route workspaceId="team" />);
  });
  act(() => useWorkspaceStore.getState().setCurrentWorkspaceId('personal'));
  act(() => renderer.update(<Route workspaceId="team" />));
  expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('personal');
});
