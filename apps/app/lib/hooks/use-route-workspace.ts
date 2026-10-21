import { useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { useWorkspaces } from './use-workspaces';

/** A deep link selects its workspace only when the reader is a member there. */
export function useRouteWorkspace(workspaceId: string | undefined) {
  const { data: workspaces } = useWorkspaces();
  const select = useWorkspaceStore((state) => state.setCurrentWorkspaceId);
  useEffect(() => {
    // A deliberate switch must be able to leave this route without its old
    // workspace winning a race against navigation.
    if (
      workspaceId &&
      workspaceId !== useWorkspaceStore.getState().currentWorkspaceId &&
      workspaces?.some((w) => w.id === workspaceId)
    ) {
      select(workspaceId);
    }
  }, [workspaceId, workspaces, select]);
}
