import type { EditorDocument } from '@oxy.so/bloom-editor/model';
import type { OfflineFiles } from '../offline-files';
import { MAX_RECENT, type OfflineCopy, OfflinePages } from '../offline-pages';

jest.mock('expo-file-system', () => ({}));

class MemoryFiles implements OfflineFiles {
  readonly files = new Map<string, string>();
  failNextWrite = false;
  async read(name: string) {
    return this.files.get(name) ?? null;
  }
  async write(name: string, text: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('disk full');
    }
    this.files.set(name, text);
  }
  async remove(name: string) {
    this.files.delete(name);
  }
  async clear() {
    this.files.clear();
  }
}

const copy = (version: number): OfflineCopy => ({
  version,
  base: { version } as unknown as EditorDocument,
  orders: [],
});

let files: MemoryFiles;
let clock: number;
let pages: OfflinePages;
beforeEach(() => {
  files = new MemoryFiles();
  clock = 1_000;
  pages = new OfflinePages(files, () => clock);
});

it('keeps an opened page as a recent one, with its copy', async () => {
  await pages.opened('a');
  await pages.save('a', copy(3));
  expect(await pages.read('a')).toEqual(copy(3));
  const [entry] = await pages.list();
  expect(entry).toMatchObject({
    pageId: 'a',
    reasons: ['recent'],
    openedAt: 1_000,
    savedAt: 1_000,
  });
  expect(entry?.bytes).toBe(JSON.stringify(copy(3)).length);
});

it('saves no copy of a page it does not keep', async () => {
  await pages.save('stranger', copy(1));
  expect(await pages.read('stranger')).toBeNull();
  expect(files.files.has('stranger.json')).toBe(false);
});

it('never replaces a copy with an older version', async () => {
  await pages.opened('a');
  await pages.save('a', copy(5));
  await pages.save('a', copy(4));
  expect((await pages.read('a'))?.version).toBe(5);
});

it(`keeps the last ${MAX_RECENT} pages opened, and every pinned one`, async () => {
  await pages.opened('pinned-and-old');
  await pages.setPinned('pinned-and-old', true);
  for (let i = 0; i < MAX_RECENT + 2; i += 1) {
    clock += 1;
    await pages.opened(`p${i}`);
    await pages.save(`p${i}`, copy(1));
  }
  const kept = (await pages.list()).map((entry) => entry.pageId);
  expect(kept).toHaveLength(MAX_RECENT + 1);
  expect(kept).toContain('pinned-and-old');
  expect(kept).not.toContain('p0');
  expect(kept).not.toContain('p1');
  // The dropped ones' copies go with them.
  expect(files.files.has('p0.json')).toBe(false);
  expect(files.files.has(`p${MAX_RECENT + 1}.json`)).toBe(true);
  const pinned = (await pages.list()).find((entry) => entry.pageId === 'pinned-and-old');
  expect(pinned?.reasons).toEqual(['pinned']);
});

it('drops a page unpinned with no other reason to keep it', async () => {
  await pages.setPinned('a', true);
  await pages.save('a', copy(1));
  await pages.setPinned('a', false);
  expect(await pages.list()).toEqual([]);
  expect(await pages.read('a')).toBeNull();
});

it('keeps an unpinned page that was opened lately', async () => {
  await pages.opened('a');
  await pages.setPinned('a', true);
  await pages.setPinned('a', false);
  expect((await pages.list())[0]?.reasons).toEqual(['recent']);
});

it('forgets a page whatever its reasons', async () => {
  await pages.opened('a');
  await pages.setPinned('a', true);
  await pages.save('a', copy(1));
  await pages.forget('a');
  expect(await pages.list()).toEqual([]);
  expect(files.files.size).toBe(1); // the index alone
});

it('names a kept page for the list, and not one it does not keep', async () => {
  await pages.opened('a');
  await pages.describe('a', { title: 'Plan', workspaceId: 'w' });
  await pages.describe('b', { title: 'Other', workspaceId: 'w' });
  expect(await pages.list()).toEqual([
    expect.objectContaining({ pageId: 'a', title: 'Plan', workspaceId: 'w' }),
  ]);
});

it('reads an unreadable index or copy as nothing kept', async () => {
  files.files.set('index.json', '{not json');
  expect(await pages.list()).toEqual([]);
  await pages.opened('a');
  files.files.set('a.json', '{');
  expect(await pages.read('a')).toBeNull();
});

it('goes on after a write fails', async () => {
  files.failNextWrite = true;
  await pages.opened('a');
  await pages.opened('b');
  expect((await pages.list()).map((entry) => entry.pageId)).toEqual(['b']);
});

it('tells listeners when what is kept changes', async () => {
  const heard = jest.fn();
  const stop = pages.subscribe(heard);
  await pages.opened('a');
  await pages.clear();
  stop();
  await pages.opened('b');
  expect(heard).toHaveBeenCalledTimes(2);
});

it('keeps nothing where there is no storage for it (a browser)', async () => {
  const web = new OfflinePages(null);
  expect(web.supported).toBe(false);
  await web.opened('a');
  await web.setPinned('a', true);
  await web.save('a', copy(1));
  expect(await web.read('a')).toBeNull();
  expect(await web.list()).toEqual([]);
});
