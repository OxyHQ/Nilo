import { useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';

interface VerifyInput {
  databaseId: string;
  rowId: string;
  propertyId: string;
  /** 7, 30 or 90 days; null is until someone removes it; absent, the property's default. */
  expiresInDays?: number | null;
}

/**
 * Verify a page, or remove its verification. The server stamps who and when:
 * a verification is never written as an ordinary property value.
 */
export function useVerifyPage() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VerifyInput & { action: 'verify' | 'unverify' }>({
    mutationFn: async ({ rowId, propertyId, action, expiresInDays }) => {
      await apiClient.post(API_ROUTES.pages.verification(rowId), {
        action,
        propertyId,
        ...(action === 'verify' && expiresInDays !== undefined && { expiresInDays }),
      });
    },
    onSettled: (_data, _err, { databaseId, rowId }) => {
      queryClient.invalidateQueries({ queryKey: ['database', databaseId, 'rows'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.row(databaseId, rowId) });
    },
  });
}
