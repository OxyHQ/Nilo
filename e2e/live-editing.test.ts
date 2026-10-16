/**
 * End to end: editors on one page, each wired exactly as the app wires one
 * (`usePageEditor`: a `PageSession` holding the page's Yjs document, an
 * `EditorStore` bound to it, a device store), talking to the real page room
 * over Socket.IO, against PostgreSQL. After concurrent edits every editor,
 * the server's document and the projected block rows must be the same page.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type CommandContext,
  type EditorDocument,
  EditorStore,
  editText,
  emptyDocument,
  getBlock,
  indent,
  insertBlockAfter,
  moveBlocks,
  outdent,
  removeBlocks,
  splitBlock,
  turnInto,
} from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA, rowsToDocument } from '@oxy.so/nilo-contracts/editor';
import { uuidv7 } from '@oxy.so/db';
import { eq } from 'drizzle-orm';
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
import { blocks, pages } from '../apps/api/src/db/schema/pages.js';
import { workspaceMembers } from '../apps/api/src/db/schema/workspaces.js';
import { ensureDefaultTeamspace } from '../apps/api/src/repositories/teamspaces.js';
import { MemoryPageDocStore } from '../apps/app/lib/editor/doc-store-types';
import { PageSession, type SessionSocket } from '../apps/app/lib/editor/page-session';

const ctx = vi.hoisted(() => ({ io: null as Server | null }));

vi.mock('../apps/api/src/socket.js', () => ({ getIO: () => ctx.io }));
vi.mock('../apps/api/src/lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('../apps/api/src/lib/notification-service.js', () => ({ sendNotification: vi.fn() }));

const { registerPageRooms } = await import('../apps/api/src/collab/page-rooms.js');
const { registerPageDocs } = await import('../apps/api/src/collab/page-docs.js');
const { flushProjections } = await import('../apps/api/src/lib/page-projection.js');
const { loadPageDoc } = await import('../apps/api/src/lib/page-docs.js');
const { getDb } = await import('../apps/api/src/db/client.js');
const { materialize } = await import('@oxy.so/bloom-editor/yjs');

let db: TestDatabase;
let httpServer: http.Server;
let base: string;
let workspaceId: string;
let previousDatabaseUrl: string | undefined;
const sockets: ClientSocket[] = [];

interface Editor {
  store: () => EditorStore;
  socket: ClientSocket;
  session: PageSession;
  docs: MemoryPageDocStore;
}

async function createPage(): Promise<string> {
  // In the workspace's open teamspace, where every member reaches it.
  const teamspace = await ensureDefaultTeamspace(db, workspaceId, 'ana');
  const [page] = await db
    .insert(pages)
    .values({ workspaceId, ownerId: 'ana', title: 'Live', teamspaceId: teamspace.id })
    .returning({ id: pages.id });
  return page?.id as string;
}

/** An editor wired as `usePageEditor` wires one. */
async function openEditor(
  pageId: string,
  userId: string,
  options: { readOnly?: boolean; docs?: MemoryPageDocStore; online?: boolean } = {},
): Promise<Editor> {
  const socket = connect(base, {
    auth: { userId },
    forceNew: true,
    reconnection: false,
    autoConnect: options.online !== false,
    transports: ['websocket'],
  });
  sockets.push(socket);
  if (options.online !== false) {
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  }
  const docs = options.docs ?? new MemoryPageDocStore();
  let store: EditorStore | null = null;
  let ready: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const session = new PageSession({
    pageId,
    socket: socket as unknown as SessionSocket,
    store: docs,
    readOnly: options.readOnly ?? false,
    onReady: (doc) => {
      store = new EditorStore({ document: emptyDocument(), schema: NILO_SCHEMA, newId: uuidv7 });
      new YjsBinding(store, doc, { readOnly: options.readOnly });
      ready();
    },
    onStatus: () => {},
    onRejected: () => {},
    onUnavailable: () => ready(),
  });
  await session.start();
  await opened;
  return {
    socket,
    session,
    docs,
    store: () => {
      if (!store) throw new Error('The page did not open');
      return store;
    },
  };
}

/** A document as plain data in reading order, for comparing two of them. */
function snapshot(doc: EditorDocument): string {
  const visit = (ids: readonly string[]): unknown[] =>
    ids.map((id) => {
      const block = getBlock(doc, id);
      return {
        id,
        type: block.type,
        text: (block.text ?? []).map((s) => s.text).join(''),
        children: visit(block.children),
      };
    });
  return JSON.stringify(visit(doc.root));
}

const texts = (doc: EditorDocument) =>
  doc.root.map((id) => (getBlock(doc, id).text ?? []).map((s) => s.text).join(''));

/** Every editor, the server's document and the projected rows hold the same page. */
async function expectConverged(pageId: string, editors: Editor[]): Promise<EditorDocument> {
  const server = async () => materialize(await loadPageDoc(getDb(), pageId));
  try {
    await vi.waitFor(
      async () => {
        const truth = snapshot(await server());
        for (const editor of editors) expect(snapshot(editor.store().doc)).toBe(truth);
      },
      { timeout: 10_000, interval: 50 },
    );
  } catch (err) {
    if (process.env.LIVE_DEBUG) {
      console.error('SERVER', snapshot(await server()));
      const { loadPageState } = await import('../apps/api/src/lib/page-docs.js');
      const Y = await import('yjs');
      const { state } = await loadPageState(getDb(), pageId);
      const size = (u: Uint8Array) => {
        const d = Y.decodeUpdate(u);
        return `${d.structs.length} structs, ${d.ds.clients.size} delete clients`;
      };
      for (const editor of editors) {
        const local = Y.encodeStateAsUpdate(editor.session.doc);
        console.error(
          'GAP',
          editor.socket.connected,
          'device lacks:',
          size(Y.diffUpdate(state, Y.encodeStateVector(editor.session.doc))),
          '| server lacks:',
          size(Y.diffUpdate(local, Y.encodeStateVectorFromUpdate(state))),
          '| pending structs on device:',
          String(editor.session.doc.store.pendingStructs !== null),
        );
      }
    }
    throw err;
  }
  await flushProjections();
  const rows = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
  const stored = rowsToDocument(rows);
  expect(snapshot(stored)).toBe(snapshot(await server()));
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
    { workspaceId, userId: 'cai', role: 'viewer' },
  ]);
  httpServer = http.createServer();
  ctx.io = new Server(httpServer);
  ctx.io.use((socket, next) => {
    socket.data.userId = socket.handshake.auth.userId;
    next();
  });
  ctx.io.on('connection', (socket) => {
    registerPageRooms(ctx.io as Server, socket);
    registerPageDocs(ctx.io as Server, socket);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await flushProjections();
  ctx.io?.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousDatabaseUrl;
});

describe('live editing through the API', () => {
  it('keeps two editors, the document and the rows in step under concurrent edits', async () => {
    const pageId = await createPage();
    const ana = await openEditor(pageId, 'ana');
    ana.store().run((c) => insertBlockAfter(c, null, 'heading_1', { text: [{ text: 'Plan' }] }));
    const ben = await openEditor(pageId, 'ben');
    await vi.waitFor(() => expect(texts(ben.store().doc)).toEqual(['Plan']));

    const firstId = ana.store().doc.root[0] as string;
    // Both edit at once, in different places and in the same one.
    ana.store().run((c) => insertBlockAfter(c, firstId, 'todo', { text: [{ text: 'from ana' }] }));
    ben
      .store()
      .run((c) => insertBlockAfter(c, firstId, 'paragraph', { text: [{ text: 'from ben' }] }));
    ana.store().run((c) => splitBlock(c, firstId, 2));
    ben.store().run((c) => editText(c, firstId, [{ text: 'Planning' }]));
    await expectConverged(pageId, [ana, ben]);

    const last = ben.store().doc.root.at(-1) as string;
    ben.store().run((c) => removeBlocks(c, [last]));
    ana.store().run((c) => insertBlockAfter(c, null, 'quote', { text: [{ text: 'end' }] }));
    const stored = await expectConverged(pageId, [ana, ben]);
    expect(stored.root.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps both people's words when they type in one block at once", async () => {
    const pageId = await createPage();
    const ana = await openEditor(pageId, 'ana');
    ana
      .store()
      .run((c) => insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'the plan' }] }));
    const ben = await openEditor(pageId, 'ben');
    await vi.waitFor(() => expect(texts(ben.store().doc)).toEqual(['the plan']));
    const id = ana.store().doc.root[0] as string;
    // Neither has seen the other's change.
    ana.store().run((c) => editText(c, id, [{ text: 'the new plan' }]));
    ben.store().run((c) => editText(c, id, [{ text: 'the plan for May' }]));
    const stored = await expectConverged(pageId, [ana, ben]);
    expect(texts(stored)).toEqual(['the new plan for May']);
  });

  it('keeps work done offline through closing the app, and sends it once back online', async () => {
    const pageId = await createPage();
    const docs = new MemoryPageDocStore();
    const first = await openEditor(pageId, 'ana', { docs });
    first.store().run((c) => insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'saved' }] }));
    await expectConverged(pageId, [first]);

    // The connection goes; the work goes on; the app is closed.
    first.socket.disconnect();
    const savedId = first.store().doc.root[0] as string;
    first
      .store()
      .run((c) => insertBlockAfter(c, savedId, 'paragraph', { text: [{ text: 'offline' }] }));
    await first.session.dispose();
    expect(await docs.isDirty(pageId)).toBe(true);
    const other = await openEditor(pageId, 'ben');
    other
      .store()
      .run((c) => insertBlockAfter(c, null, 'heading_2', { text: [{ text: 'meanwhile' }] }));

    // Reopened offline: the work is there. Then the connection comes back.
    const reopened = await openEditor(pageId, 'ana', { docs, online: false });
    expect(texts(reopened.store().doc)).toEqual(['saved', 'offline']);
    reopened.socket.connect();
    const stored = await expectConverged(pageId, [reopened, other]);
    // Both went to the end at once: the same place, one order everywhere.
    expect(texts(stored).sort()).toEqual(['meanwhile', 'offline', 'saved']);
    expect(texts(stored).indexOf('offline')).toBe(texts(stored).indexOf('saved') + 1);
    await vi.waitFor(async () => expect(await docs.isDirty(pageId)).toBe(false));
  });

  it('keeps a read-only page live, leaving the toggles its viewer closed alone', async () => {
    const pageId = await createPage();
    const ana = await openEditor(pageId, 'ana');
    ana.store().run((c) => insertBlockAfter(c, null, 'toggle', { text: [{ text: 'Details' }] }));
    await expectConverged(pageId, [ana]);
    const viewer = await openEditor(pageId, 'cai', { readOnly: true });
    const toggleId = viewer.store().doc.root[0] as string;
    const props = getBlock(viewer.store().doc, toggleId).props;
    viewer.store().dispatch({
      ops: [
        {
          kind: 'update',
          id: toggleId,
          before: { props },
          after: { props: { ...props, expanded: false } },
        },
      ],
    });

    ana.store().run((c) => insertBlockAfter(c, null, 'heading_2', { text: [{ text: 'Top' }] }));
    ana.store().run((c) => editText(c, toggleId, [{ text: 'Details, more' }]));
    const stored = await expectConverged(pageId, [ana]);
    await vi.waitFor(() => expect(texts(viewer.store().doc)).toEqual(texts(stored)));
    expect(getBlock(viewer.store().doc, toggleId).props.expanded).toBe(false);
    // A viewer's change never reaches the page.
    expect(getBlock(stored, toggleId).props.expanded).not.toBe(false);
  });

  // `LIVE_SEEDS=1,2,3` and `LIVE_STEPS=200` run a longer soak locally.
  const seeds = process.env.LIVE_SEEDS?.split(',').map(Number) ?? [5, 17, 29, 41];
  const steps = Number(process.env.LIVE_STEPS ?? 80);
  it.each(seeds)(
    'converges under random concurrent editing, connections dropping (seed %i)',
    async (start) => {
      const pageId = await createPage();
      let seed = start;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
      };
      const ana = await openEditor(pageId, 'ana');
      const ben = await openEditor(pageId, 'ben');
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      /** Editors offline, and the step at which each comes back. */
      const backAt = new Map<Editor, number>();
      for (let step = 0; step < steps; step += 1) {
        const editor = pick([ana, ben]);
        const ids = Object.keys(editor.store().doc.blocks);
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
          (c: CommandContext) =>
            id && getBlock(c.doc, id).text ? editText(c, id, [{ text: `e${step}` }]) : null,
        ]);
        editor.store().run(command);
        // Now and then a connection drops, and comes back a few steps later.
        if (random() < 0.05 && editor.socket.connected) {
          editor.socket.disconnect();
          backAt.set(editor, step + 1 + Math.floor(random() * 6));
        }
        for (const [who, at] of backAt) {
          if (at > step) continue;
          backAt.delete(who);
          who.socket.connect();
        }
        if (random() < 0.2) await new Promise((r) => setTimeout(r, 10));
      }
      for (const editor of [ana, ben]) {
        if (!editor.socket.connected) editor.socket.connect();
      }
      await vi.waitFor(() => expect([ana, ben].every((e) => e.socket.connected)).toBe(true));
      await expectConverged(pageId, [ana, ben]);
    },
  );
});
