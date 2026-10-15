import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useExportPage, useImportPages } from '../use-page-transfer';
import { queryKeys } from '../query-keys';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
}));

let client: QueryClient;
let renderer: ReactTestRenderer;
let imports: ReturnType<typeof useImportPages>;
let exports: ReturnType<typeof useExportPage>;
const result = {
  pages: [{ id: 'first', title: 'Title', parentId: 'parent' }],
  skipped: ['data.csv'],
};
const onProgress = jest.fn();
const fetchFile = jest.spyOn(global, 'fetch');

function Hooks() {
  imports = useImportPages();
  exports = useExportPage();
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
  jest.mocked(apiClient.post).mockResolvedValue({ data: result });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
afterAll(() => fetchFile.mockRestore());

it('reads Markdown URIs, sends the destination, and refreshes page lists', async () => {
  fetchFile.mockResolvedValue({ text: async () => '# Title\nBody' } as Response);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {
    const response = await imports.mutateAsync({
      workspaceId: 'workspace',
      parentId: 'parent',
      assets: [{ lastModified: 0, uri: 'file:///note.md', name: 'note.md' }],
      onProgress,
    });
    expect(response).toEqual(result);
  });
  expect(fetchFile).toHaveBeenCalledWith('file:///note.md');
  const [route, body] = jest.mocked(apiClient.post).mock.calls[0];
  expect(route).toBe('/pages/import');
  if (typeof body !== 'string') throw new Error('Expected a JSON body');
  expect(JSON.parse(body)).toEqual({
    workspaceId: 'workspace',
    parentId: 'parent',
    files: [{ path: 'note.md', content: '# Title\nBody' }],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pages.list('workspace') });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.pages.shared });
});

it('sends ZIP bytes unchanged with the ZIP content type and query destination', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]).buffer;
  fetchFile.mockResolvedValue({ arrayBuffer: async () => bytes } as Response);
  await act(async () => {
    await imports.mutateAsync({
      workspaceId: 'workspace',
      parentId: 'parent',
      assets: [{ lastModified: 0, uri: 'blob:zip', name: 'export.zip' }],
      onProgress,
    });
  });
  expect(apiClient.post).toHaveBeenCalledWith(
    '/pages/import/zip',
    bytes,
    expect.objectContaining({
      params: { workspaceId: 'workspace', parentId: 'parent' },
      headers: { 'Content-Type': 'application/zip' },
    }),
  );
});

it('rejects mixed selections before reading or posting files', async () => {
  await act(async () => {
    await expect(
      imports.mutateAsync({
        workspaceId: 'workspace',
        assets: [
          { lastModified: 0, uri: 'blob:a', name: 'a.md' },
          { lastModified: 0, uri: 'blob:b', name: 'b.zip' },
        ],
        onProgress,
      }),
    ).rejects.toThrow('invalidFiles');
  });
  expect(fetchFile).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each(['md', 'html'] as const)(
  'exports %s as a blob using the server filename',
  async (format) => {
    const blob = new Blob(['document']);
    jest.mocked(apiClient.get).mockResolvedValue({
      data: blob,
      headers: { 'content-disposition': `attachment; filename*=UTF-8''Caf%C3%A9.${format}` },
    });
    await act(async () => {
      await expect(
        exports.mutateAsync({ id: 'page', format, fallback: 'Untitled' }),
      ).resolves.toEqual({ blob, filename: `Café.${format}` });
    });
    expect(apiClient.get).toHaveBeenCalledWith('/pages/page/export', {
      params: { format },
      responseType: 'blob',
    });
  },
);
