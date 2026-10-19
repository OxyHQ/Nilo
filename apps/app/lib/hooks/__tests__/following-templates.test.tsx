import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { usePageFollow, useSetPageFollow } from '../use-page-follow';
import { useCreateRowTemplate, useRowTemplates } from '../use-row-templates';
import { useCreateRow } from '../use-database-rows';
import { queryKeys } from '../query-keys';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: jest.fn(), delete: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let follow: ReturnType<typeof useSetPageFollow>;
let createTemplate: ReturnType<typeof useCreateRowTemplate>;
let createRow: ReturnType<typeof useCreateRow>;
function Hooks() {
  usePageFollow('page');
  useRowTemplates('db');
  follow = useSetPageFollow('page');
  createTemplate = useCreateRowTemplate('db');
  createRow = useCreateRow();
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/follow') ? { following: false } : { templates: [] },
  }));
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
it('reads following, follows with PUT and unfollows with DELETE', async () => {
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/follow');
  await act(async () => {
    await follow.mutateAsync(true);
  });
  expect(apiClient.put).toHaveBeenCalledWith('/pages/page/follow');
  await act(async () => {
    await follow.mutateAsync(false);
  });
  expect(apiClient.delete).toHaveBeenCalledWith('/pages/page/follow');
});
it('creates a template in one request, never as a listed row, then refreshes the database', async () => {
  jest.mocked(apiClient.post).mockResolvedValue({ data: { row: { id: 'template' } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {
    expect(await createTemplate.mutateAsync('Template')).toEqual({ id: 'template' });
  });
  expect(apiClient.post).toHaveBeenCalledWith('/databases/db/rows', {
    title: 'Template',
    template: true,
  });
  expect(apiClient.patch).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.databases.detail('db') });
});
it('creates from a template without sending any generated property values', async () => {
  jest.mocked(apiClient.post).mockResolvedValue({ data: { row: { id: 'new' } } });
  await act(async () => {
    await createRow.mutateAsync({ databaseId: 'db', templateId: 'template' });
  });
  expect(apiClient.post).toHaveBeenCalledWith('/databases/db/rows', { templateId: 'template' });
});
