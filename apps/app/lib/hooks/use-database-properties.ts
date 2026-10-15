import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import type {
  Database,
  DatabaseResponse,
  DatabasePropertyType,
  PropertyConfig,
} from '../types/databases';

interface AddPropertyInput {
  databaseId: string;
  id?: string;
  name: string;
  type: DatabasePropertyType;
  config?: Omit<PropertyConfig, 'syncedPropertyId'>;
}

interface UpdatePropertyInput {
  databaseId: string;
  propertyId: string;
  name?: string;
  type?: DatabasePropertyType;
  config?: Omit<PropertyConfig, 'syncedPropertyId'>;
}

interface DeletePropertyInput {
  databaseId: string;
  propertyId: string;
}

function propertyInput<T extends { config?: PropertyConfig }>(input: T) {
  if (!input.config) return input;
  const { syncedPropertyId: _serverOwned, ...config } = input.config;
  return { ...input, config };
}

function targetBefore(client: QueryClient, databaseId: string, propertyId: string) {
  return client
    .getQueryData<DatabaseResponse>(queryKeys.databases.detail(databaseId))
    ?.database.schema.properties.find((p) => p.id === propertyId)?.config?.targetDatabaseId;
}

function refreshProperties(client: QueryClient, ids: (string | undefined)[]) {
  return Promise.all(
    [...new Set(ids.filter((id): id is string => Boolean(id)))].map((id) =>
      client.invalidateQueries({ queryKey: queryKeys.databases.detail(id) }),
    ),
  );
}

export function useAddProperty() {
  const queryClient = useQueryClient();
  return useMutation<Database, Error, AddPropertyInput>({
    mutationFn: async ({ databaseId, ...input }) => {
      const res = await apiClient.post<DatabaseResponse>(
        API_ROUTES.databases.addProperty(databaseId),
        propertyInput(input),
      );
      return res.data.database;
    },
    onSettled: (_database, _error, input) =>
      refreshProperties(queryClient, [input.databaseId, input.config?.targetDatabaseId]),
  });
}

export function useUpdateProperty() {
  const queryClient = useQueryClient();
  return useMutation<Database, Error, UpdatePropertyInput, string | undefined>({
    mutationFn: async ({ databaseId, propertyId, ...input }) => {
      const res = await apiClient.patch<DatabaseResponse>(
        API_ROUTES.databases.updateProperty(databaseId, propertyId),
        propertyInput(input),
      );
      return res.data.database;
    },
    onMutate: (input) => targetBefore(queryClient, input.databaseId, input.propertyId),
    onSettled: (_database, _error, input, previousTarget) =>
      refreshProperties(queryClient, [
        input.databaseId,
        input.config?.targetDatabaseId,
        previousTarget,
      ]),
  });
}

export function useDeleteProperty() {
  const queryClient = useQueryClient();
  return useMutation<Database, Error, DeletePropertyInput, string | undefined>({
    mutationFn: async ({ databaseId, propertyId }) => {
      const res = await apiClient.delete<DatabaseResponse>(
        API_ROUTES.databases.deleteProperty(databaseId, propertyId),
      );
      return res.data.database;
    },
    onMutate: (input) => targetBefore(queryClient, input.databaseId, input.propertyId),
    onSettled: (_database, _error, input, previousTarget) =>
      refreshProperties(queryClient, [input.databaseId, previousTarget]),
  });
}
