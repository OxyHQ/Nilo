/**
 * End to end: two editors on one page, each with its own EditorStore,
 * SyncSession and the app's wire conversion, saving through the real
 * transactions endpoint and hearing each other through the real page room —
 * against PostgreSQL. After concurrent edits both editors and the stored
 * blocks must be the same document.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type CommandContext,
  documentToSnapshot,
  type EditorDocument,
  EditorStore,
  getBlock,
  indent,
  insertBlockAfter,
  moveBlocks,
  outdent,
  removeBlocks,
  splitBlock,
  SyncSession,
  type Transaction,
  turnInto,
} from '@oxy.so/bloom-editor/model';
import express from 'express';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
  testDatabaseUrl,
} from '../apps/api/src/db/__tests__/testDatabase.js';
import { closeDb } from '../apps/api/src/db/client.js';
import { pages } from '../apps/api/src/db/schema/pages.js';
import { workspaceMembers } from '../apps/api/src/db/schema/workspaces.js';
import { NILO_SCHEMA } from '../apps/app/lib/editor/schema';
import {
  type AppliedOperation,
  blocksToDocument,
  reconcileOrder,
  transactionToWire,
  wireToOperations,
} from '../apps/app/lib/editor/wire';

const ctx = vi.hoisted(() => ({ io: null as Server | null }));

vi.mock('../apps/api/src/middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {},
}));
vi.mock('../apps/api/src/middleware/workspace.js', () => ({
  requireWorkspaceMember: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.workspace = { id: String(req.header('X-Workspace-Id')), role: 'editor' };
    next();
  },
}));
vi.mock('../apps/api/src/socket.js', () => ({ getIO: () => ctx.io }));
vi.mock('../apps/api/src/lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: blocksRouter } = await import('../apps/api/src/routes/blocks.js');
const { registerPageRooms } = await import('../apps/api/src/collab/page-rooms.js');

let db: TestDatabase;
let httpServer: http.Server;
let base: string;
let workspaceId: string;
let previousDatabaseUrl: string | undefined;
const sockets: ClientSocket[] = [];

interface Editor {
  name: string;
  store: EditorStore;
  session: SyncSession;
  desyncs: string[];
  /** What the editor sent, had acknowledged and received, for `LIVE_TRACE`. */
  log: unknown[];
}

/** A UUIDv7, as the app mints them (`apps/app/lib/ids.ts`). */
function uuidv7(): string {
  const bytes = randomBytes(16);
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function createPage(): Promise<string> {
  const [page] = await db
    .insert(pages)
    .values({ workspaceId, ownerId: 'ana', title: 'Live' })
    .returning({ id: pages.id });
  return page?.id as string;
}

async function loadBlocks(pageId: string) {
  const res = await fetch(`${base}/pages/${pageId}/blocks`, { headers: { 'x-test-user': 'ana' } });
  return (await res.json()) as { blocks: Parameters<typeof blocksToDocument>[0]; version: number };
}

/** An editor wired exactly as `usePageEditor` wires one, over fetch and socket.io. */
async function openEditor(pageId: string, userId: string): Promise<Editor> {
  const loaded = await loadBlocks(pageId);
  const { doc, orders } = blocksToDocument(loaded.blocks, loaded.version);
  const store = new EditorStore({ document: doc, schema: NILO_SCHEMA, newId: uuidv7 });
  const socket = connect(base, {
    auth: { userId },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  const desyncs: string[] = [];
  const log: unknown[] = [];
  const session = new SyncSession(
    store,
    {
      send: async (tx: Transaction, before) => {
        const ops = transactionToWire(tx, before);
        log.push({ ev: 'send', local: tx.ops, ops });
        const res = await fetch(`${base}/pages/${pageId}/blocks/transactions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-test-user': userId,
            'X-Workspace-Id': workspaceId,
          },
          body: JSON.stringify({ ops, socketId: socket.id }),
        });
        if (res.ok) {
          const { version, ops: applied } = (await res.json()) as {
            version: number;
            ops: AppliedOperation[];
          };
          orders.recordApplied(applied, version);
          log.push({ ev: 'ack', version, applied });
          return { ok: true, version };
        }
        log.push({ ev: 'refused', status: res.status, body: await res.text() });
        return { ok: false, retry: res.status >= 500 };
      },
    },
    {
      version: loaded.version,
      reconcile: (d) => reconcileOrder(d, orders),
      onDesync: (reason) => desyncs.push(reason),
      onRejected: (tx) => log.push({ ev: 'rejected', ops: tx.ops }),
    },
  );
  socket.on(
    'page:transaction',
    (event: { pageId: string; version: number; ops: AppliedOperation[] }) => {
      if (event.pageId !== pageId) return;
      log.push({ ev: 'remote', version: event.version, ops: event.ops });
      session.receiveRemote({
        version: event.version,
        toOperations: (d) => {
          const ops = wireToOperations(d, event.ops, orders, event.version);
          log.push({ ev: 'apply', version: event.version, ops });
          return ops;
        },
      });
    },
  );
  await new Promise<void>((resolve) => socket.emit('page:join', pageId, () => resolve()));
  return { name: userId, store, session, desyncs, log };
}

async function settle(editors: Editor[]) {
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
    if (editors.every((e) => !e.session.hasPending)) {
      // Let the last broadcasts land.
      await new Promise((r) => setTimeout(r, 150));
      if (editors.every((e) => !e.session.hasPending)) return;
    }
  }
  throw new Error('editors did not settle');
}

const snapshot = (doc: EditorDocument) => JSON.stringify(documentToSnapshot(doc));

async function expectConverged(pageId: string, editors: Editor[]) {
  await settle(editors);
  const stored = blocksToDocument((await loadBlocks(pageId)).blocks).doc;
  const converged = editors.every(
    (e) => e.desyncs.length === 0 && snapshot(e.store.doc) === snapshot(stored),
  );
  // `LIVE_TRACE=<dir>` keeps the whole exchange of a failing run for diagnosis.
  if (!converged && process.env.LIVE_TRACE) {
    const { writeFileSync } = await import('node:fs');
    const trace = {
      stored,
      editors: editors.map((e) => ({ name: e.name, doc: e.store.doc, log: e.log })),
    };
    writeFileSync(`${process.env.LIVE_TRACE}/trace-${pageId}.json`, JSON.stringify(trace));
  }
  for (const editor of editors) {
    expect(editor.desyncs).toEqual([]);
    expect(snapshot(editor.store.doc)).toBe(snapshot(stored));
  }
  return stored;
}

beforeAll(async () => {
  db = await getTestDb();
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'live-editing');
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: 'ana', role: 'editor' },
    { workspaceId, userId: 'ben', role: 'editor' },
  ]);

  const app = express();
  app.use(express.json());
  app.use(blocksRouter);
  httpServer = http.createServer(app);
  ctx.io = new Server(httpServer);
  ctx.io.use((socket, next) => {
    socket.data.userId = socket.handshake.auth.userId;
    next();
  });
  ctx.io.on('connection', (socket) => registerPageRooms(ctx.io as Server, socket));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  ctx.io?.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousDatabaseUrl;
});

describe('live editing through the API', () => {
  it('keeps two editors and the database in step under concurrent edits', async () => {
    const pageId = await createPage();
    const ana = await openEditor(pageId, 'ana');
    ana.store.run((c) => insertBlockAfter(c, null, 'heading_1', { text: [{ text: 'Plan' }] }));
    await settle([ana]);
    const ben = await openEditor(pageId, 'ben');

    const firstId = ana.store.doc.root[0] as string;
    // Both type at once, in different and in the same places.
    ana.store.run((c) => insertBlockAfter(c, firstId, 'todo', { text: [{ text: 'from ana' }] }));
    ben.store.run((c) =>
      insertBlockAfter(c, firstId, 'paragraph', { text: [{ text: 'from ben' }] }),
    );
    ana.store.run((c) => splitBlock(c, firstId, 2));
    const benFirst = getBlock(ben.store.doc, firstId);
    ben.store.dispatch({
      ops: [
        {
          kind: 'update',
          id: firstId,
          before: { text: benFirst.text },
          after: { text: [{ text: 'Planning' }] },
        },
      ],
    });
    await settle([ana, ben]);

    const last = ben.store.doc.root[ben.store.doc.root.length - 1] as string;
    ben.store.run((c) => removeBlocks(c, [last]));
    ana.store.run((c) => insertBlockAfter(c, null, 'quote', { text: [{ text: 'end' }] }));
    const stored = await expectConverged(pageId, [ana, ben]);
    expect(stored.root.length).toBeGreaterThanOrEqual(4);
  });

  // `LIVE_SEEDS=1,2,3` and `LIVE_STEPS=200` run a longer soak locally.
  const seeds = process.env.LIVE_SEEDS?.split(',').map(Number) ?? [5, 17, 29, 41];
  const steps = Number(process.env.LIVE_STEPS ?? 80);
  it.each(seeds)(
    'converges under random concurrent editing from both sides (seed %i)',
    async (start) => {
      const pageId = await createPage();
      const ana = await openEditor(pageId, 'ana');
      const ben = await openEditor(pageId, 'ben');
      let seed = start;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
      };
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      for (let step = 0; step < steps; step += 1) {
        const editor = pick([ana, ben]);
        const ids = Object.keys(editor.store.doc.blocks);
        const id = ids.length > 0 ? pick(ids) : null;
        const command = pick([
          (c: CommandContext) =>
            insertBlockAfter(c, id, pick(['paragraph', 'todo', 'heading_2', 'toggle']), {
              text: [{ text: `s${step}` }],
            }),
          (c: CommandContext) => (id ? splitBlock(c, id, 1) : null),
          (c: CommandContext) => (id && ids.length > 3 ? removeBlocks(c, [id]) : null),
          (c: CommandContext) => (id ? indent(c, id) : null),
          (c: CommandContext) => (id ? outdent(c, id) : null),
          (c: CommandContext) =>
            id ? turnInto(c, id, pick(['paragraph', 'todo', 'quote', 'callout'])) : null,
          (c: CommandContext) =>
            id ? moveBlocks(c, [id], pick(ids), pick(['before', 'after'] as const)) : null,
        ]);
        editor.store.run(command);
        if (id && editor.store.doc.blocks[id] && random() < 0.3) {
          const block = getBlock(editor.store.doc, id);
          if (block.text) {
            editor.store.dispatch({
              ops: [
                {
                  kind: 'update',
                  id,
                  before: { text: block.text },
                  after: { text: [{ text: `e${step}` }] },
                },
              ],
            });
          }
        }
        if (random() < 0.2) await new Promise((r) => setTimeout(r, 10));
      }
      await expectConverged(pageId, [ana, ben]);
    },
  );
});
