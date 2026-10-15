import { AxiosError } from 'axios';
import apiClient from '@/lib/api/client';
import type { OfflineFiles } from '../offline-files';
import { OfflinePages } from '../offline-pages';
import { refreshPinnedPages } from '../offline-sync';

jest.mock('expo-file-system', () => ({}));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));

const memory = (): OfflineFiles => {
  const files = new Map<string, string>();
  return {
    read: async (name) => files.get(name) ?? null,
    write: async (name, text) => void files.set(name, text),
    remove: async (name) => void files.delete(name),
    clear: async () => files.clear(),
  };
};
const failure = (status?: number) =>
  Object.assign(new AxiosError('failed'), status ? { response: { status } } : {});
const blocks = (version: number) => ({ data: { blocks: [], version } });

it('reads every pinned page again, drops the ones lost, and stops when the connection is gone', async () => {
  const store = new OfflinePages(memory());
  for (const id of ['kept', 'lost', 'offline', 'after']) await store.setPinned(id, true);
  await store.opened('recent-only');
  jest.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url.includes('kept')) return blocks(7);
    if (url.includes('lost')) throw failure(403);
    if (url.includes('offline')) throw failure();
    return blocks(1);
  });

  await refreshPinnedPages(store);

  const asked = jest.mocked(apiClient.get).mock.calls.map(([url]) => url);
  expect(asked.some((url) => url.includes('recent-only'))).toBe(false);
  expect(asked.some((url) => url.includes('after'))).toBe(false);
  expect((await store.read('kept'))?.version).toBe(7);
  expect((await store.list()).map((entry) => entry.pageId)).not.toContain('lost');
  expect(await store.read('offline')).toBeNull();
});
