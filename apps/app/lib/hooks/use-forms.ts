import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import type { PublicForm } from '../forms';
import type { PropertyValue } from '../types/databases';
import { queryKeys } from './query-keys';

export interface FormLink {
  id: string;
  viewId: string;
  token: string;
  open: boolean;
  requireSignIn: boolean;
}
const linkPath = (id: string, viewId: string) => `/databases/${id}/views/${viewId}/form`;
export function useFormLink(id: string, viewId: string) {
  return useQuery({
    queryKey: queryKeys.forms.link(id, viewId),
    queryFn: async ({ signal }) =>
      (await apiClient.get<{ form: FormLink | null }>(linkPath(id, viewId), { signal })).data,
    retry: false,
  });
}
export function useChangeFormLink(id: string, viewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { open?: boolean; requireSignIn?: boolean } | null) => {
      if (patch === null) {
        await apiClient.delete(linkPath(id, viewId));
        return { form: null };
      }
      return (await apiClient.put<{ form: FormLink }>(linkPath(id, viewId), patch)).data;
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.forms.link(id, viewId), data);
      void client.invalidateQueries({ queryKey: queryKeys.forms.all });
    },
  });
}
export function usePublicForm(token: string) {
  const { user, isAuthenticated } = useOxy();
  return useQuery({
    queryKey: queryKeys.forms.public(token, isAuthenticated ? user?.id : undefined),
    queryFn: async ({ signal }) =>
      (await apiClient.get<PublicForm>(`/forms/${encodeURIComponent(token)}`, { signal })).data,
    enabled: Boolean(token),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
export function useSubmitForm(token: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, PropertyValue>) =>
      (await apiClient.post(`/forms/${encodeURIComponent(token)}`, { values })).data,
    retry: false,
    onSuccess: () => {
      // The public descriptor deliberately contains no database id.
      void client.invalidateQueries({ queryKey: ['database'] });
      void client.invalidateQueries({ queryKey: ['pages'] });
      void client.invalidateQueries({ queryKey: queryKeys.search.all });
    },
  });
}
