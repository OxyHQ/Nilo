import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';

export function usePageFollow(pageId: string) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.pages.follow(pageId),
    queryFn: async () =>
      (await apiClient.get<{ following: boolean }>(API_ROUTES.pages.follow(pageId))).data,
    enabled: isAuthenticated,
  });
}

export function useSetPageFollow(pageId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (following: boolean) => {
      if (following) await apiClient.put(API_ROUTES.pages.follow(pageId));
      else await apiClient.delete(API_ROUTES.pages.follow(pageId));
      return { following };
    },
    onSuccess: (data) => client.setQueryData(queryKeys.pages.follow(pageId), data),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.pages.follow(pageId) }),
  });
}
