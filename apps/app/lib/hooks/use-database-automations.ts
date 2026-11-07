import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Automation, AutomationInput, AutomationPatch } from '@oxy.so/nilo-contracts';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';

/** A database's automations. */
export function useDatabaseAutomations(databaseId: string, enabled = true) {
  return useQuery<Automation[]>({
    queryKey: queryKeys.databases.automations(databaseId),
    queryFn: async () => {
      const res = await apiClient.get<{ automations: Automation[] }>(
        API_ROUTES.databases.automations(databaseId),
      );
      return res.data.automations;
    },
    enabled,
  });
}

/** Make an automation; the answer carries the webhook secret, which is shown once. */
export function useCreateAutomation(databaseId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ automation: Automation; secret: string }, Error, AutomationInput>({
    mutationFn: async (input) =>
      (await apiClient.post(API_ROUTES.databases.automations(databaseId), input)).data,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.automations(databaseId) }),
  });
}

export function useUpdateAutomation(databaseId: string) {
  const queryClient = useQueryClient();
  return useMutation<Automation, Error, { id: string; patch: AutomationPatch }>({
    mutationFn: async ({ id, patch }) =>
      (
        await apiClient.patch<{ automation: Automation }>(
          API_ROUTES.databases.automation(databaseId, id),
          patch,
        )
      ).data.automation,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.automations(databaseId) }),
  });
}

export function useDeleteAutomation(databaseId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiClient.delete(API_ROUTES.databases.automation(databaseId, id));
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.automations(databaseId) }),
  });
}
