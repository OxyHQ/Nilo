/**
 * Where offline copies of pages live. The app on iOS and Android keeps them
 * as files (`offline-files.native.ts`); a browser keeps them in IndexedDB,
 * beside the pages' documents (`doc-store.ts`), and its service worker
 * (`public/sw.js`) keeps the app itself, so a page kept offline opens
 * without a connection on the web too, as in Notion's desktop apps.
 */
export interface OfflineFiles {
  read(name: string): Promise<string | null>;
  /** Replaces the file whole, or leaves the old one. */
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
}

const DATABASE = 'nilo-offline';
const FILES = 'files';

let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DATABASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILES);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

/** One transaction on the files: its request's answer once the transaction is done. */
async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = (await database()).transaction(FILES, mode);
  const req = work(tx.objectStore(FILES));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Each write is one `put` in its own transaction: a file is replaced whole or not at all. */
export const offlineFiles: OfflineFiles | null =
  typeof indexedDB === 'undefined'
    ? null
    : {
        async read(name) {
          const text = await run('readonly', (store) => store.get(name));
          return typeof text === 'string' ? text : null;
        },
        async write(name, text) {
          await run('readwrite', (store) => store.put(text, name));
        },
        async remove(name) {
          await run('readwrite', (store) => store.delete(name));
        },
        async clear() {
          await run('readwrite', (store) => store.clear());
        },
      };
