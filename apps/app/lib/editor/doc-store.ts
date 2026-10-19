import type { PageDocStore, StoredPageDoc } from './doc-store-types';

const DATABASE = 'nilo-documents';
const UPDATES = 'updates';
const PAGES = 'pages';

let opened: Promise<IDBDatabase> | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const updates = db.createObjectStore(UPDATES, { keyPath: 'seq', autoIncrement: true });
      updates.createIndex('page', 'pageId');
      db.createObjectStore(PAGES, { keyPath: 'pageId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function updateKeys(tx: IDBTransaction, pageId: string): Promise<IDBValidKey[]> {
  return request(tx.objectStore(UPDATES).index('page').getAllKeys(IDBKeyRange.only(pageId)));
}

/**
 * Pages' documents in IndexedDB: the pages kept offline (`offline-pages.ts`),
 * and any page while it holds work the server has not confirmed, so a reload
 * or a lost connection loses nothing.
 */
export const pageDocStore: PageDocStore | null =
  typeof indexedDB === 'undefined'
    ? null
    : {
        async load(pageId) {
          const db = await database();
          const tx = db.transaction([UPDATES, PAGES], 'readonly');
          const rows = (await request(
            tx.objectStore(UPDATES).index('page').getAll(IDBKeyRange.only(pageId)),
          )) as { seq: number; data: Uint8Array }[];
          const page = (await request(tx.objectStore(PAGES).get(pageId))) as
            | { dirty: boolean }
            | undefined;
          if (rows.length === 0) return null;
          const stored: StoredPageDoc = {
            updates: rows.sort((a, b) => a.seq - b.seq).map((row) => row.data),
            dirty: page?.dirty ?? false,
          };
          return stored;
        },
        async append(pageId, update, local) {
          const db = await database();
          const tx = db.transaction([UPDATES, PAGES], 'readwrite');
          tx.objectStore(UPDATES).add({ pageId, data: update });
          const pages = tx.objectStore(PAGES);
          const page = (await request(pages.get(pageId))) as { dirty: boolean } | undefined;
          pages.put({ pageId, dirty: (page?.dirty ?? false) || local });
          await done(tx);
        },
        async markSynced(pageId) {
          const db = await database();
          const tx = db.transaction(PAGES, 'readwrite');
          tx.objectStore(PAGES).put({ pageId, dirty: false });
          await done(tx);
        },
        async compact(pageId, state) {
          const db = await database();
          const tx = db.transaction(UPDATES, 'readwrite');
          const store = tx.objectStore(UPDATES);
          for (const key of await updateKeys(tx, pageId)) store.delete(key);
          store.add({ pageId, data: state });
          await done(tx);
        },
        async isDirty(pageId) {
          const db = await database();
          const tx = db.transaction(PAGES, 'readonly');
          const page = (await request(tx.objectStore(PAGES).get(pageId))) as
            | { dirty: boolean }
            | undefined;
          return page?.dirty ?? false;
        },
        async remove(pageId, options) {
          const db = await database();
          const tx = db.transaction([UPDATES, PAGES], 'readwrite');
          const page = (await request(tx.objectStore(PAGES).get(pageId))) as
            | { dirty: boolean }
            | undefined;
          if (!page?.dirty || options?.force) {
            const store = tx.objectStore(UPDATES);
            for (const key of await updateKeys(tx, pageId)) store.delete(key);
            tx.objectStore(PAGES).delete(pageId);
          }
          await done(tx);
        },
        async clear() {
          const db = await database();
          const tx = db.transaction([UPDATES, PAGES], 'readwrite');
          tx.objectStore(UPDATES).clear();
          tx.objectStore(PAGES).clear();
          await done(tx);
        },
      };
