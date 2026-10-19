import { API_ROUTES } from '../api/routes';
import { useAuthQuery } from './create-query';
import { queryKeys } from './query-keys';

interface PageRef {
  id: string;
  title: string;
  icon: string | null;
}

/** Where an original is shown (`GET /blocks/:id/synced`): pages the caller can open. */
export interface SyncedUsages {
  original: { blockId: string; page: PageRef };
  references: { blockId: string; page: PageRef }[];
}

/** An original the caller may paste (`GET /workspaces/:id/synced-blocks`). */
export interface SyncedBlockSummary {
  blockId: string;
  page: PageRef;
  /** The start of its text. */
  preview: string;
}

/**
 * The pages showing an original. Read from the projected rows, so a block
 * made a moment ago answers 404 until it is there.
 */
export function useSyncedUsages(blockId: string | undefined) {
  return useAuthQuery<SyncedUsages>(
    queryKeys.syncedBlocks.usages(blockId ?? 'none'),
    API_ROUTES.syncedBlocks.usages(blockId ?? ''),
    undefined,
    { enabled: Boolean(blockId), staleTime: 1000 * 30, retry: false },
  );
}

export function useSyncedBlocks(workspaceId: string | undefined) {
  return useAuthQuery<{ syncedBlocks: SyncedBlockSummary[] }>(
    queryKeys.syncedBlocks.list(workspaceId ?? 'none'),
    API_ROUTES.syncedBlocks.list(workspaceId ?? ''),
    undefined,
    { enabled: Boolean(workspaceId), staleTime: 1000 * 15 },
  );
}
