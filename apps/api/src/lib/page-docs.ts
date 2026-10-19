/**
 * A page's document: a Yjs `Y.Doc` in the layout of
 * `@oxy.so/bloom-editor/yjs`, stored as a compacted snapshot (`page_docs`)
 * plus the updates that arrived since (`page_updates`).
 *
 * Every change, from an editor or from the server itself, is an update
 * appended here; the document is the merge of all of them, which Yjs makes the
 * same whatever order they arrived in. The `blocks` rows everyone else reads
 * (search, exports, share links, published pages) are projected from it
 * (`page-projection.ts`).
 *
 * Locks: appending and reading hold the page row FOR SHARE (side by side),
 * compaction, seeding and projecting FOR UPDATE, so an update can never get an
 * id at or below a snapshot that did not include it, and a read never sees a
 * compaction half done.
 *
 * Every function takes a `PgHandle`: the database, or a transaction a caller
 * already holds (a note written with its fields, `lib/notes.ts`), in which it
 * runs as a savepoint. Sending a change to the room is the caller's, once its
 * transaction committed: a device given a change that then rolled back would
 * send it back by its next handshake.
 */
import { applyOperation, type EditorDocument, type Transaction } from '@oxy.so/bloom-editor/model';
import { materialize, writeDocument, writeTransaction } from '@oxy.so/bloom-editor/yjs';
import { MAX_DOC_UPDATE_BYTES } from '@oxy.so/nilo-contracts';
import { rowsToDocument } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { getDb, type PgHandle } from '../db/client.js';
import { listBlocksForPage } from '../repositories/blocks.js';
import {
  appendPageUpdate,
  findPageDoc,
  listPageUpdates,
  pendingPageUpdates,
  savePageDoc,
} from '../repositories/pageDocs.js';
import { lockPage, lockPageShared } from '../repositories/pages.js';
import { log } from './logger.js';

/** The origin of changes the server writes itself. */
export const SERVER_ORIGIN = 'nilo:server';
/** Fold updates into the snapshot once this many wait. */
const COMPACT_AFTER = 200;
/** Appends a process lets pass between two looks at whether to compact. */
const COMPACT_CHECK_EVERY = 50;
const appendsSinceCheck = new Map<string, number>();

export class PageDocRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PageDocRejected';
  }
}

/**
 * Store a page that has no document yet from its block rows, once: under
 * the page's row lock, so two first readers cannot both seed it (two seeds
 * would hold every block twice).
 */
async function ensurePageDoc(
  db: PgHandle,
  pageId: string,
): Promise<{ state: Uint8Array; throughId: number }> {
  const existing = await findPageDoc(db, pageId);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    if (!(await lockPage(tx, pageId))) throw new PageDocRejected(404, 'Page not found');
    const seeded = await findPageDoc(tx, pageId);
    if (seeded) return seeded;
    const doc = new Y.Doc();
    const rows = await listBlocksForPage(tx, pageId);
    writeDocument(doc, rowsToDocument(rows), SERVER_ORIGIN);
    const state = Y.encodeStateAsUpdate(doc);
    await savePageDoc(tx, { pageId, state, throughId: 0 });
    return { state, throughId: 0 };
  });
}

/**
 * The snapshot and the updates after it, read with `db`: a repeatable-read
 * transaction, or one holding the page's row lock (no compaction then).
 */
export async function readPageState(
  db: PgHandle,
  pageId: string,
): Promise<{ state: Uint8Array; lastId: number }> {
  const snapshot = await findPageDoc(db, pageId);
  if (!snapshot) throw new PageDocRejected(404, 'Page not found');
  const updates = await listPageUpdates(db, pageId, snapshot.throughId);
  if (updates.length === 0) return { state: snapshot.state, lastId: snapshot.throughId };
  return {
    state: Y.mergeUpdates([snapshot.state, ...updates.map((u) => u.update)]),
    lastId: updates[updates.length - 1]?.id ?? snapshot.throughId,
  };
}

/** The page's whole document as one update, and the id of the newest update in it. */
export async function loadPageState(
  db: PgHandle,
  pageId: string,
): Promise<{ state: Uint8Array; lastId: number }> {
  await ensurePageDoc(db, pageId);
  return db.transaction(async (tx) => {
    // No compaction while the snapshot and the updates after it are read.
    if (!(await lockPageShared(tx, pageId))) throw new PageDocRejected(404, 'Page not found');
    return readPageState(tx, pageId);
  });
}

export { ensurePageDoc };

/** The page's document as a `Y.Doc`. */
export async function loadPageDoc(db: PgHandle, pageId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadPageState(db, pageId)).state, SERVER_ORIGIN);
  return doc;
}

/**
 * Append one update to a page. Refuses an empty, oversized or malformed one,
 * a page that is gone or locked against edits, and — `byEditor`, a change
 * someone typed — a page in the trash.
 */
export async function appendUpdate(
  db: PgHandle,
  input: { pageId: string; update: Uint8Array; actorId: string; byEditor?: boolean },
): Promise<number> {
  if (input.update.byteLength === 0) throw new PageDocRejected(400, 'Empty update');
  if (input.update.byteLength > MAX_DOC_UPDATE_BYTES) {
    throw new PageDocRejected(413, 'Update too large', 'UPDATE_TOO_LARGE');
  }
  try {
    Y.decodeUpdate(input.update);
  } catch {
    throw new PageDocRejected(400, 'Malformed update');
  }
  // Seeded first: an update must never land on a page that will be seeded later.
  await ensurePageDoc(db, input.pageId);
  const id = await db.transaction(async (tx) => {
    const page = await lockPageShared(tx, input.pageId);
    // A page in the trash keeps content a server write may still change (an
    // import of trashed notes); someone reading it there cannot.
    if (!page) throw new PageDocRejected(404, 'Page not found');
    if (page.locked) throw new PageDocRejected(423, 'The page is locked', 'PAGE_LOCKED');
    if (input.byEditor && page.archived) {
      throw new PageDocRejected(409, 'The page is in the trash', 'PAGE_ARCHIVED');
    }
    return appendPageUpdate(tx, {
      pageId: input.pageId,
      update: input.update,
      actorId: input.actorId,
    });
  });
  // Not a query per keystroke: each process looks every so many appends.
  const appends = (appendsSinceCheck.get(input.pageId) ?? 0) + 1;
  if (appends < COMPACT_CHECK_EVERY) appendsSinceCheck.set(input.pageId, appends);
  else {
    appendsSinceCheck.delete(input.pageId);
    // On its own connection, after: never inside the caller's transaction.
    void compactPage(getDb(), input.pageId).catch((err: unknown) =>
      log.general.warn({ err, pageId: input.pageId }, 'Page document compaction failed'),
    );
  }
  if (appendsSinceCheck.size > 10_000) appendsSinceCheck.clear();
  return id;
}

/**
 * Fold the updates into the snapshot once enough wait: those the rows already
 * show, so the ones still to project keep who made them.
 */
export async function compactPage(db: PgHandle, pageId: string, force = false): Promise<void> {
  const snapshot = await findPageDoc(db, pageId);
  if (!snapshot) return;
  const pending = await pendingPageUpdates(db, pageId, snapshot.throughId);
  if (pending.count === 0 || (!force && pending.count < COMPACT_AFTER)) return;
  await db.transaction(async (tx) => {
    if (!(await lockPage(tx, pageId))) return;
    const current = await findPageDoc(tx, pageId);
    if (!current) return;
    const updates = (await listPageUpdates(tx, pageId, current.throughId)).filter(
      (u) => u.id <= current.projectedThroughId,
    );
    const last = updates[updates.length - 1];
    if (!last) return;
    const state = Y.mergeUpdates([current.state, ...updates.map((u) => u.update)]);
    await savePageDoc(tx, { pageId, state, throughId: last.id });
  });
}

/**
 * A change the server makes itself (an import, a restore): built against the
 * document as it is now, written into it, and appended as one update.
 * Returns the update (null when the change changed nothing) for the caller
 * to broadcast and project.
 */
export async function writeServerChange(
  db: PgHandle,
  input: {
    pageId: string;
    actorId: string;
    change: (doc: EditorDocument) => Transaction | null;
  },
): Promise<Uint8Array | null> {
  const doc = await loadPageDoc(db, input.pageId);
  const before = materialize(doc);
  const tx = input.change(before);
  if (!tx || tx.ops.length === 0) return null;
  let after = before;
  for (const op of tx.ops) after = applyOperation(after, op);
  let update: Uint8Array | null = null;
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === SERVER_ORIGIN) update = update ? Y.mergeUpdates([update, u]) : u;
  });
  writeTransaction(doc, tx, after, SERVER_ORIGIN);
  if (!update) return null;
  await appendUpdate(db, { pageId: input.pageId, update, actorId: input.actorId });
  return update;
}
