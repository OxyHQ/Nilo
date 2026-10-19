import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useChangeFormLink, usePublicForm, useSubmitForm } from '../use-forms';
import { queryKeys } from '../query-keys';

let mockUserId: string | undefined;
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: Boolean(mockUserId),
    user: mockUserId ? { id: mockUserId } : null,
  }),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let link: ReturnType<typeof useChangeFormLink>;
let submit: ReturnType<typeof useSubmitForm>;
function Hooks() {
  link = useChangeFormLink('db', 'view');
  submit = useSubmitForm('token');
  usePublicForm('token');
  return null;
}
const tree = () => (
  <QueryClientProvider client={client}>
    <Hooks />
  </QueryClientProvider>
);
beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = undefined;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest
    .mocked(apiClient.get)
    .mockResolvedValue({ data: { title: 'Form', description: '', fields: [] } });
  await act(async () => {
    renderer = create(tree());
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('re-fetches public descriptors on sign-in and account changes', async () => {
  expect(client.getQueryData(queryKeys.forms.public('token'))).toMatchObject({ title: 'Form' });
  mockUserId = 'alice';
  await act(async () => {
    renderer.update(tree());
  });
  expect(client.getQueryData(queryKeys.forms.public('token', 'alice'))).toMatchObject({
    title: 'Form',
  });
  mockUserId = 'bob';
  await act(async () => {
    renderer.update(tree());
  });
  expect(apiClient.get).toHaveBeenCalledTimes(3);
});
it('creates, closes and deletes a link while replacing cached link data', async () => {
  const form = { id: 'link', viewId: 'view', token: 'new-token', open: true, requireSignIn: false };
  jest
    .mocked(apiClient.put)
    .mockResolvedValueOnce({ data: { form } })
    .mockResolvedValueOnce({ data: { form: { ...form, open: false } } });
  await act(async () => {
    await link.mutateAsync({});
  });
  expect(apiClient.put).toHaveBeenCalledWith('/databases/db/views/view/form', {});
  expect(client.getQueryData(queryKeys.forms.link('db', 'view'))).toEqual({ form });
  await act(async () => {
    await link.mutateAsync({ open: false });
  });
  expect(client.getQueryData(queryKeys.forms.link('db', 'view'))).toEqual({
    form: { ...form, open: false },
  });
  await act(async () => {
    await link.mutateAsync(null);
  });
  expect(apiClient.delete).toHaveBeenCalledWith('/databases/db/views/view/form');
  expect(client.getQueryData(queryKeys.forms.link('db', 'view'))).toEqual({ form: null });
});
it('posts exactly one response and invalidates database rows and search', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  jest.mocked(apiClient.post).mockResolvedValue({ data: { ok: true } });
  await act(async () => {
    await submit.mutateAsync({ name: { text: 'Answer' } });
  });
  expect(apiClient.post).toHaveBeenCalledWith('/forms/token', {
    values: { name: { text: 'Answer' } },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['database'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.search.all });
});
it('never automatically retries a failed submission', async () => {
  jest.mocked(apiClient.post).mockRejectedValue(new Error('rate limited'));
  await act(async () => {
    await expect(submit.mutateAsync({ name: { text: 'Answer' } })).rejects.toThrow('rate limited');
  });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});
