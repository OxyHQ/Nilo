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

interface UpdatePropertyContext {
  previousTarget: string | undefined;
  previous: DatabaseResponse | undefined;
}

/**
 * A property's name, type or config. Shown at once in the database's cache
 * (a setting changed twice in a row builds on the first), put back if the API
 * refuses it; a new type's values are the API's to convert, so they are read
 * again either way.
 */
export function useUpdateProperty() {
  const queryClient = useQueryClient();
  return useMutation<Database, Error, UpdatePropertyInput, UpdatePropertyContext>({
    mutationFn: async ({ databaseId, propertyId, ...input }) => {
      const res = await apiClient.patch<DatabaseResponse>(
        API_ROUTES.databases.updateProperty(databaseId, propertyId),
        propertyInput(input),
      );
      return res.data.database;
    },
    onMutate: async ({ databaseId, propertyId, ...patch }) => {
      const previousTarget = targetBefore(queryClient, databaseId, propertyId);
      const key = queryKeys.databases.detail(databaseId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<DatabaseResponse>(key);
      if (previous) {
        queryClient.setQueryData<DatabaseResponse>(key, {
          ...previous,
          database: {
            ...previous.database,
            schema: {
              properties: previous.database.schema.properties.map((p) =>
                p.id === propertyId
                  ? {
                      ...p,
                      ...(patch.name !== undefined && { name: patch.name }),
                      ...(patch.type !== undefined && { type: patch.type }),
                      ...(patch.config !== undefined && {
                        config: { ...patch.config, syncedPropertyId: p.config?.syncedPropertyId },
                      }),
                    }
                  : p,
              ),
            },
          },
        });
      }
      return { previousTarget, previous };
    },
    onError: (_error, { databaseId }, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKeys.databases.detail(databaseId), context.previous);
    },
    onSettled: async (_database, _error, input, context) => {
      await refreshProperties(queryClient, [
        input.databaseId,
        input.config?.targetDatabaseId,
        context?.previousTarget,
      ]);
      if (input.type !== undefined)
        await queryClient.invalidateQueries({ queryKey: ['database', input.databaseId, 'rows'] });
    },
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

interface ReorderPropertiesInput {
  databaseId: string;
  /** The properties' ids in their new order. */
  ids: string[];
}

/** The order of a database's properties (`PUT /databases/:id/properties/order`), shown at once. */
export function useReorderProperties() {
  const queryClient = useQueryClient();
  return useMutation<Database, Error, ReorderPropertiesInput, DatabaseResponse | undefined>({
    mutationFn: async ({ databaseId, ids }) => {
      const res = await apiClient.put<DatabaseResponse>(
        API_ROUTES.databases.reorderProperties(databaseId),
        { ids },
      );
      return res.data.database;
    },
    onMutate: async ({ databaseId, ids }) => {
      const key = queryKeys.databases.detail(databaseId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DatabaseResponse>(key);
      if (previous) {
        const rank = new Map(ids.map((id, i) => [id, i]));
        const properties = [...previous.database.schema.properties].sort(
          (a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length),
        );
        queryClient.setQueryData<DatabaseResponse>(key, {
          ...previous,
          database: { ...previous.database, schema: { properties } },
        });
      }
      return previous;
    },
    onError: (_error, { databaseId }, previous) => {
      if (previous) queryClient.setQueryData(queryKeys.databases.detail(databaseId), previous);
    },
    onSettled: (_database, _error, { databaseId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.detail(databaseId) }),
  });
}
