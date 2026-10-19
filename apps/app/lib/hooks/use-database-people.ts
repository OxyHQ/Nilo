import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import type { WorkspaceMemberUser } from './use-workspace-members';

/** Someone a person property can name: a member of the workspace, or a guest of it. */
export interface DatabasePerson {
  userId: string;
  guest: boolean;
  /** Their Oxy profile; null when Oxy did not answer for them. */
  user: WorkspaceMemberUser | null;
}

/**
 * Who a person property of the database can name, as the API checks a write
 * (`GET /databases/:id/people`): its picker offers no one else. For the
 * database's editors; `enabled` waits until a picker opens.
 */
export function useDatabasePeople(databaseId: string | undefined, enabled = true) {
  const { isAuthenticated } = useOxy();
  return useQuery<DatabasePerson[]>({
    queryKey: queryKeys.databases.people(databaseId ?? 'none'),
    queryFn: async () => {
      if (!databaseId) throw new Error('Database id required');
      const res = await apiClient.get<{ people: DatabasePerson[] }>(
        API_ROUTES.databases.people(databaseId),
      );
      return res.data.people;
    },
    enabled: enabled && isAuthenticated && Boolean(databaseId),
    staleTime: 30_000,
  });
}
