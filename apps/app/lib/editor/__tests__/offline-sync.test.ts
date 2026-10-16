import { AxiosError } from 'axios';
import * as Y from 'yjs';
import apiClient from '@/lib/api/client';
import { fromBase64, toBase64 } from '../base64';
import { MemoryPageDocStore } from '../doc-store-types';
import type { OfflineFiles } from '../offline-files';
import { OfflinePages } from '../offline-pages';
import { refreshPinnedPages } from '../offline-sync';

jest.mock('expo-file-system', () => ({}));
jest.mock('expo-sqlite', () => ({}));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));

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

/** The server's document for a page: one text with `words` in it. */
function serverDoc(words: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, words);
  return doc;
}

it('brings every pinned page up to date, drops the ones lost, and stops when the connection is gone', async () => {
  const docs = new MemoryPageDocStore();
  const pages = new OfflinePages(memory(), docs);
  for (const id of ['kept', 'lost', 'offline', 'after']) await pages.setPinned(id, true);
  await pages.opened('recent-only');
  const server = serverDoc('hola');
  jest.mocked(apiClient.post).mockImplementation(async (url: string, body: unknown) => {
    if (url.includes('lost')) throw failure(403);
    if (url.includes('offline')) throw failure();
    const vector = fromBase64((body as { stateVector: string }).stateVector);
    return { data: { update: toBase64(Y.encodeStateAsUpdate(server, vector)) } };
  });

  await refreshPinnedPages(pages, docs);

  const asked = jest.mocked(apiClient.post).mock.calls.map(([url]) => url);
  expect(asked.some((url) => url.includes('recent-only'))).toBe(false);
  expect(asked.some((url) => url.includes('after'))).toBe(false);
  const kept = await docs.load('kept');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.mergeUpdates(kept?.updates ?? []));
  expect(doc.getText('t').toString()).toBe('hola');
  expect((await pages.list()).map((entry) => entry.pageId)).not.toContain('lost');
  expect((await pages.list()).find((entry) => entry.pageId === 'kept')?.bytes).toBeGreaterThan(0);
});

it('asks only for what the device lacks', async () => {
  const docs = new MemoryPageDocStore();
  const pages = new OfflinePages(memory(), docs);
  await pages.setPinned('p', true);
  const server = serverDoc('uno');
  await docs.append('p', Y.encodeStateAsUpdate(server), false);
  server.getText('t').insert(3, ' dos');
  let asked: Uint8Array | null = null;
  jest.mocked(apiClient.post).mockImplementation(async (_url: string, body: unknown) => {
    asked = fromBase64((body as { stateVector: string }).stateVector);
    return { data: { update: toBase64(Y.encodeStateAsUpdate(server, asked)) } };
  });
  await refreshPinnedPages(pages, docs);
  expect(asked).not.toBeNull();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.mergeUpdates((await docs.load('p'))?.updates ?? []));
  expect(doc.getText('t').toString()).toBe('uno dos');
});
