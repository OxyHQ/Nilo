import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Switch } from '@oxy.so/bloom/switch';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { RelationSettings } from '../relation-settings';
import { useDeleteProperty } from '@/lib/hooks/use-database-properties';
import apiClient from '@/lib/api/client';
import type { Database, DatabaseProperty } from '@/lib/types/databases';

jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabases: () => ({ data: { databases: [{ id: 'target', name: 'Projects' }] } }),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
/** Holds the confirm surface open until the test answers it. */
function pendingConfirm() {
  let answer: (confirmed: boolean) => void = () => {};
  jest.mocked(confirm).mockReturnValue(
    new Promise<boolean>((resolve) => {
      answer = resolve;
    }),
  );
  return (confirmed: boolean) =>
    act(async () => {
      answer(confirmed);
      // Let the awaiting handler run its continuation inside this act.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
const property: DatabaseProperty = {
  id: 'rel',
  name: 'Projects',
  type: 'relation',
  config: { targetDatabaseId: 'target', twoWay: true, syncedPropertyId: 'server-owned' },
};
const database = {
  id: 'db',
  workspaceId: 'w',
  name: 'Tasks',
  schema: { properties: [property] },
} as Database;
let client: QueryClient;
let renderer: ReactTestRenderer;
let remove: ReturnType<typeof useDeleteProperty>;
function DeleteHook() {
  remove = useDeleteProperty();
  return null;
}
const onDone = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  client.setQueryData(['database', 'db'], { database });
  jest.mocked(apiClient.patch).mockResolvedValue({ data: { database } });
  jest.mocked(apiClient.post).mockResolvedValue({ data: { database } });
  jest.mocked(apiClient.delete).mockResolvedValue({ data: { database } });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
/** The relation target's radio group (a memo component, so found by its props). */
function radioGroup() {
  return renderer.root.findAll(
    (node) => node.props.label === 'databases.relations.target' && node.props.onValueChange,
  )[0];
}
async function mount(existing?: DatabaseProperty) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <DeleteHook />
          <RelationSettings database={database} property={existing} onDone={onDone} />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
}
it('confirms before disabling two-way, strips server-owned fields, and refreshes both databases', async () => {
  await mount(property);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const answer = pendingConfirm();
  act(() => {
    renderer.root.findByType(Switch).props.onCheckedChange(false);
  });
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'databases.relations.removeTitle', destructive: true }),
  );
  expect(renderer.root.findByType(Switch).props.checked).toBe(true);
  expect(apiClient.patch).not.toHaveBeenCalled();
  await answer(true);
  expect(renderer.root.findByType(Switch).props.checked).toBe(false);
  await act(async () => {
    renderer.root.findByType(Button).props.onPress();
  });
  expect(apiClient.patch).toHaveBeenCalledWith('/databases/db/properties/rel', {
    config: { targetDatabaseId: 'target', twoWay: false },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['database', 'db'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['database', 'target'] });
  expect(onDone).toHaveBeenCalled();
});
it('creates a relation with an explicit target and twoWay flag', async () => {
  await mount();
  act(() => radioGroup().props.onValueChange('target'));
  act(() => {
    renderer.root.findByType(Switch).props.onCheckedChange(true);
  });
  await act(async () => renderer.root.findByType(Button).props.onPress());
  expect(apiClient.post).toHaveBeenCalledWith('/databases/db/properties', {
    name: 'databases.propertyTypes.relation',
    type: 'relation',
    config: { targetDatabaseId: 'target', twoWay: true },
  });
});
it('invalidates the removed reciprocal database even when it is absent from the response', async () => {
  await mount(property);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {
    await remove.mutateAsync({ databaseId: 'db', propertyId: 'rel' });
  });
  expect(apiClient.delete).toHaveBeenCalledWith('/databases/db/properties/rel');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['database', 'target'] });
});

it('asks before retargeting an existing reciprocal, then saves the new target', async () => {
  await mount(property);
  act(() => radioGroup().props.onValueChange('db'));
  const answer = pendingConfirm();
  act(() => {
    renderer.root.findByType(Button).props.onPress();
  });
  expect(confirm).toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
  await answer(true);
  expect(apiClient.patch).toHaveBeenCalledWith('/databases/db/properties/rel', {
    config: { targetDatabaseId: 'db', twoWay: true },
  });
});
