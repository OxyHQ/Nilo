import * as SQLite from 'expo-sqlite';
import type { PageDocStore, StoredPageDoc } from './doc-store-types';

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

/** The app's documents database, created on first use. */
function database(): Promise<SQLite.SQLiteDatabase> {
  opened ??= SQLite.openDatabaseAsync('nilo-documents.db').then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id TEXT NOT NULL,
        data BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS updates_page ON updates (page_id, seq);
      CREATE TABLE IF NOT EXISTS pages (
        page_id TEXT PRIMARY KEY,
        dirty INTEGER NOT NULL DEFAULT 0
      );
    `);
    return db;
  });
  return opened;
}

/** Pages' documents in SQLite: kept across launches, one row per update. */
export const pageDocStore: PageDocStore | null = {
  async load(pageId) {
    const db = await database();
    const rows = await db.getAllAsync<{ data: Uint8Array }>(
      'SELECT data FROM updates WHERE page_id = ? ORDER BY seq',
      pageId,
    );
    if (rows.length === 0) return null;
    const page = await db.getFirstAsync<{ dirty: number }>(
      'SELECT dirty FROM pages WHERE page_id = ?',
      pageId,
    );
    const stored: StoredPageDoc = {
      updates: rows.map((row) => row.data),
      dirty: page?.dirty === 1,
    };
    return stored;
  },
  async append(pageId, update, local) {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT INTO updates (page_id, data) VALUES (?, ?)', pageId, update);
      await db.runAsync(
        `INSERT INTO pages (page_id, dirty) VALUES (?, ?)
         ON CONFLICT (page_id) DO UPDATE SET dirty = MAX(dirty, excluded.dirty)`,
        pageId,
        local ? 1 : 0,
      );
    });
  },
  async markSynced(pageId) {
    const db = await database();
    await db.runAsync('UPDATE pages SET dirty = 0 WHERE page_id = ?', pageId);
  },
  async compact(pageId, state) {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM updates WHERE page_id = ?', pageId);
      await db.runAsync('INSERT INTO updates (page_id, data) VALUES (?, ?)', pageId, state);
    });
  },
  async isDirty(pageId) {
    const db = await database();
    const page = await db.getFirstAsync<{ dirty: number }>(
      'SELECT dirty FROM pages WHERE page_id = ?',
      pageId,
    );
    return page?.dirty === 1;
  },
  async remove(pageId, options) {
    const db = await database();
    await db.withTransactionAsync(async () => {
      const page = await db.getFirstAsync<{ dirty: number }>(
        'SELECT dirty FROM pages WHERE page_id = ?',
        pageId,
      );
      if (page?.dirty === 1 && !options?.force) return;
      await db.runAsync('DELETE FROM updates WHERE page_id = ?', pageId);
      await db.runAsync('DELETE FROM pages WHERE page_id = ?', pageId);
    });
  },
  async clear() {
    const db = await database();
    await db.execAsync('DELETE FROM updates; DELETE FROM pages;');
  },
};
