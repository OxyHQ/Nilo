import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import type { DatabaseRow, DatabaseRowResponse } from '../types/databases';
import type { PageResponse } from '../types/pages';
import { queryKeys } from './query-keys';

export function useRowTemplates(databaseId: string) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.databases.templates(databaseId),
    queryFn: async () =>
      (
        await apiClient.get<{ templates: DatabaseRow[] }>(
          API_ROUTES.databases.templates(databaseId),
        )
      ).data,
    enabled: isAuthenticated,
  });
}

export function useCreateRowTemplate(databaseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (title: string) => {
      // Created as a template: it is never listed among the rows.
      const { data } = await apiClient.post<DatabaseRowResponse>(
        API_ROUTES.databases.createRow(databaseId),
        { title, template: true },
      );
      return data.row;
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.databases.detail(databaseId) }),
  });
}
