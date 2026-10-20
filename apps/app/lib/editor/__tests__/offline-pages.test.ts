import type { OfflineFiles } from '../offline-files';
import { MemoryPageDocStore } from '../doc-store-types';
import { MAX_RECENT, OfflinePages } from '../offline-pages';

jest.mock('expo-file-system', () => ({}));
jest.mock('expo-sqlite', () => ({}));

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

const update = new Uint8Array([1, 2, 3]);

let files: MemoryFiles;
let docs: MemoryPageDocStore;
let clock: number;
let pages: OfflinePages;
beforeEach(() => {
  files = new MemoryFiles();
  docs = new MemoryPageDocStore();
  clock = 1_000;
  pages = new OfflinePages(files, docs, () => clock);
});

it('keeps an opened page as a recent one, with when and how much was stored', async () => {
  await pages.opened('a');
  expect(await pages.keeps('a')).toBe(true);
  await pages.saved('a', 640);
  const [entry] = await pages.list();
  expect(entry).toMatchObject({
    pageId: 'a',
    reasons: ['recent'],
    openedAt: 1_000,
    savedAt: 1_000,
    bytes: 640,
  });
});

it('records nothing for a page it does not keep', async () => {
  await pages.saved('stranger', 10);
  expect(await pages.keeps('stranger')).toBe(false);
  expect(await pages.list()).toEqual([]);
});

it(`keeps the last ${MAX_RECENT} pages opened and every pinned one, dropping the others' documents`, async () => {
  await pages.opened('pinned-and-old');
  await pages.setPinned('pinned-and-old', true);
  await docs.append('p1', update, true); // unsent work: stays whatever the index says
  for (let i = 0; i < MAX_RECENT + 2; i += 1) {
    clock += 1;
    await docs.append(`p${i}`, update, false);
    await pages.opened(`p${i}`);
  }
  const kept = (await pages.list()).map((entry) => entry.pageId);
  expect(kept).toHaveLength(MAX_RECENT + 1);
  expect(kept).toContain('pinned-and-old');
  expect(kept).not.toContain('p0');
  expect(kept).not.toContain('p1');
  expect(await docs.load('p0')).toBeNull();
  expect(await docs.load('p1')).not.toBeNull();
  expect(await docs.load(`p${MAX_RECENT + 1}`)).not.toBeNull();
  const pinned = (await pages.list()).find((entry) => entry.pageId === 'pinned-and-old');
  expect(pinned?.reasons).toEqual(['pinned']);
});

it('drops a page unpinned with no other reason to keep it', async () => {
  await pages.setPinned('a', true);
  await docs.append('a', update, false);
  await pages.setPinned('a', false);
  expect(await pages.list()).toEqual([]);
  expect(await docs.load('a')).toBeNull();
});

it('keeps an unpinned page that was opened lately', async () => {
  await pages.opened('a');
  await pages.setPinned('a', true);
  await pages.setPinned('a', false);
  expect((await pages.list())[0]?.reasons).toEqual(['recent']);
});

it('forgets a page whatever its reasons, unsent work included', async () => {
  await pages.opened('a');
  await pages.setPinned('a', true);
  await docs.append('a', update, true);
  await pages.forget('a');
  expect(await pages.list()).toEqual([]);
  expect(await docs.load('a')).toBeNull();
});

it('names a kept page for the list, and not one it does not keep', async () => {
  await pages.opened('a');
  await pages.describe('a', { title: 'Plan', workspaceId: 'w' });
  await pages.describe('b', { title: 'Other', workspaceId: 'w' });
  expect(await pages.list()).toEqual([
    expect.objectContaining({ pageId: 'a', title: 'Plan', workspaceId: 'w' }),
  ]);
});

it('reads an unreadable index as nothing kept', async () => {
  files.files.set('index.json', '{not json');
  expect(await pages.list()).toEqual([]);
});

it('goes on after a write fails', async () => {
  files.failNextWrite = true;
  await pages.opened('a');
  await pages.opened('b');
  expect((await pages.list()).map((entry) => entry.pageId)).toEqual(['b']);
});

it('tells listeners when what is kept changes, and clears every document', async () => {
  const heard = jest.fn();
  const stop = pages.subscribe(heard);
  await docs.append('a', update, true);
  await pages.opened('a');
  await pages.clear();
  stop();
  await pages.opened('b');
  expect(heard).toHaveBeenCalledTimes(2);
  expect(await docs.load('a')).toBeNull();
});

it('keeps nothing where there is no storage for it (a browser)', async () => {
  const web = new OfflinePages(null, null);
  expect(web.supported).toBe(false);
  await web.opened('a');
  await web.setPinned('a', true);
  expect(await web.keeps('a')).toBe(false);
  expect(await web.list()).toEqual([]);
});

it('removes downloads and clean documents, preserving pending work even outside the index', async () => {
  for (const id of ['clean', 'pending']) await pages.setPinned(id, true);
  await docs.append('clean', update, false);
  await docs.append('pending', update, true);
  await docs.append('pending-unlisted', update, true);
  const heard = jest.fn();
  const stop = pages.subscribe(heard);

  await pages.removeDownloads(() => false);

  expect(await pages.list()).toEqual([]);
  expect(await docs.load('clean')).toBeNull();
  expect(await docs.load('pending')).toEqual({ updates: [update], dirty: true });
  expect(await docs.load('pending-unlisted')).toEqual({ updates: [update], dirty: true });
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  // The privacy boundary still purges pending work, indexed or not.
  await pages.clear();
  expect(await docs.load('pending')).toBeNull();
  expect(await docs.load('pending-unlisted')).toBeNull();
});

it('does not lose an edit that arrives while a clean download is being removed', async () => {
  await pages.setPinned('page', true);
  await docs.append('page', update, false);
  const remove = docs.remove.bind(docs);
  const local = new Uint8Array([4, 5, 6]);
  jest.spyOn(docs, 'remove').mockImplementationOnce(async (id, options) => {
    await docs.append(id, local, true);
    await remove(id, options);
  });

  await pages.removeDownloads(() => false);

  expect(await docs.load('page')).toEqual({ updates: [update, local], dirty: true });
  expect(await pages.list()).toEqual([]);
});

it('serializes a new download after removal so the later choice survives', async () => {
  await pages.setPinned('old', true);
  await docs.append('old', update, false);
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const removing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const remove = docs.remove.bind(docs);
  jest.spyOn(docs, 'remove').mockImplementationOnce(async (id, options) => {
    entered();
    await paused;
    await remove(id, options);
  });
  const removal = pages.removeDownloads(() => false);
  await removing;
  const pinned = pages.setPinned('new', true);
  release();
  await Promise.all([removal, pinned]);

  expect((await pages.list()).map((entry) => entry.pageId)).toEqual(['new']);
  expect(await docs.load('old')).toBeNull();
});
