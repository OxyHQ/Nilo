/** Real PostgreSQL and HTTP routers; only authentication and socket I/O are simulated. */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import type { NotesSyncPage } from '@oxy.so/nilo-contracts';
import express from 'express';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { notesSyncGenerations, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  getTestClient,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = { id };
    next();
  },
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada' }) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const previousFlag = process.env.NILO_NOTES_GENERATION_ENABLED;
const previousEpoch = process.env.NILO_NOTES_GENERATION_EPOCH;
process.env.NILO_NOTES_GENERATION_ENABLED = '1';
process.env.NILO_NOTES_GENERATION_EPOCH = 'test_deployment_epoch_A';
const generation = await import('../../lib/notes-generation.js');
const notesRepository = await import('../../repositories/notes.js');
const pageDocs = await import('../../collab/page-docs.js');
const { default: notesRouter } = await import('../notes.js');
const { default: workspacesRouter } = await import('../workspaces.js');
let db: TestDatabase;
let server: Server;
let base: string;
let previousUrl: string | undefined;
const scope = testScope('notes-generation');
type Json = Record<string, unknown>;
type GenerationSyncPage = NotesSyncPage & { generation?: string };
async function api(
  method: string,
  path: string,
  user: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': user, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
}
beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json());
  app.use('/notes', notesRouter);
  app.use('/workspaces', workspacesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(like(workspaces.ownerId, `${scope}%`));
  if (owned.length)
    await db.delete(notesSyncGenerations).where(
      inArray(
        notesSyncGenerations.workspaceId,
        owned.map(({ id }) => id),
      ),
    );
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  if (previousFlag === undefined) delete process.env.NILO_NOTES_GENERATION_ENABLED;
  else process.env.NILO_NOTES_GENERATION_ENABLED = previousFlag;
  if (previousEpoch === undefined) delete process.env.NILO_NOTES_GENERATION_EPOCH;
  else process.env.NILO_NOTES_GENERATION_EPOCH = previousEpoch;
});

describe('experimental generation-aware notes', () => {
  for (const operation of ['erase', 'reset'] as const) {
    it(`rejects stale creates, updates and deletes after ${operation} while legacy remains accepted`, async () => {
      const user = `${scope}-${operation}`;
      const before = (await api('GET', '/notes/sync?generationAware=1', user))
        .json as unknown as GenerationSyncPage;
      expect(before.generation).toMatch(/^test_deployment_epoch_A\./);
      const workspace = (await api('GET', '/workspaces/personal', user)).json.workspace as {
        id: string;
        name: string;
      };
      const removed =
        operation === 'erase'
          ? await api('POST', '/notes/erase', user, { confirm: 'DELETE' })
          : await api('POST', `/workspaces/${workspace.id}/reset`, user, {
              confirm: workspace.name,
            });
      expect(removed.status, JSON.stringify(removed.json)).toBe(200);
      const after = (
        await api(
          'GET',
          `/notes/sync?generationAware=1&cursor=${encodeURIComponent(before.cursor)}`,
          user,
        )
      ).json as unknown as GenerationSyncPage;
      expect(after.reset).toBe(true);
      expect(after.generation).not.toBe(before.generation);
      const id = uuidv7();
      if (!before.generation || !after.generation) throw new Error('Missing generation');
      const fresh = { 'X-Notes-Generation': after.generation };
      const stale = { 'X-Notes-Generation': before.generation };
      expect((await api('POST', '/notes', user, { id, title: 'current' }, fresh)).status).toBe(201);
      const oldId = uuidv7();
      for (const [method, path, body] of [
        ['POST', '/notes', { id: oldId, title: 'stale' }],
        ['PATCH', `/notes/${id}`, { title: 'stale' }],
        ['DELETE', `/notes/${id}`, undefined],
      ] as const) {
        const result = await api(method, path, user, body, stale);
        expect(result.status, JSON.stringify(result.json)).toBe(409);
        expect(result.json.code).toBe('NOTES_GENERATION_CHANGED');
      }
      expect((await api('GET', `/notes/${oldId}`, user)).status).toBe(404);
      expect((await api('GET', `/notes/${id}`, user)).json.note).toMatchObject({
        title: 'current',
      });
      expect((await api('POST', '/notes', user, { id: uuidv7(), title: 'legacy' })).status).toBe(
        201,
      );
    });
  }

  for (const operation of ['erase', 'reset'] as const) {
    it(`rejects a request prepared before ${operation} if it reaches the lock afterwards`, async () => {
      const user = `${scope}-preflight-${operation}`;
      const before = (await api('GET', '/notes/sync?generationAware=1', user))
        .json as unknown as GenerationSyncPage;
      if (!before.generation) throw new Error('Missing generation');
      const workspace = (await api('GET', '/workspaces/personal', user)).json.workspace as {
        id: string;
        name: string;
      };
      let resume!: () => void;
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = generation.lockNotesGeneration;
      const spy = vi
        .spyOn(generation, 'lockNotesGeneration')
        .mockImplementation(async (...args) => {
          if (args[3] === before.generation) {
            reached();
            await gate;
          }
          return original(...args);
        });
      const id = uuidv7();
      const pending = api(
        'POST',
        '/notes',
        user,
        { id, title: 'pending' },
        { 'X-Notes-Generation': before.generation },
      );
      try {
        await waiting;
        const removed =
          operation === 'erase'
            ? await api('POST', '/notes/erase', user, { confirm: 'DELETE' })
            : await api('POST', `/workspaces/${workspace.id}/reset`, user, {
                confirm: workspace.name,
              });
        expect(removed.status, JSON.stringify(removed.json)).toBe(200);
        resume();
        const result = await pending;
        expect(result.status, JSON.stringify(result.json)).toBe(409);
        expect(result.json.code).toBe('NOTES_GENERATION_CHANGED');
        expect((await api('GET', `/notes/${id}`, user)).status).toBe(404);
      } finally {
        resume();
        spy.mockRestore();
      }
    });

    it(`waits to ${operation} while a guarded write holds the generation lock`, async () => {
      const user = `${scope}-locked-${operation}`;
      const before = (await api('GET', '/notes/sync?generationAware=1', user))
        .json as unknown as GenerationSyncPage;
      if (!before.generation) throw new Error('Missing generation');
      const workspace = (await api('GET', '/workspaces/personal', user)).json.workspace as {
        id: string;
        name: string;
      };
      let resume!: () => void;
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = generation.lockNotesGeneration;
      const spy = vi
        .spyOn(generation, 'lockNotesGeneration')
        .mockImplementation(async (...args) => {
          const result = await original(...args);
          if (args[3] === before.generation) {
            reached();
            await gate;
          }
          return result;
        });
      const id = uuidv7();
      const pending = api(
        'POST',
        '/notes',
        user,
        { id, title: 'pending' },
        { 'X-Notes-Generation': before.generation },
      );
      try {
        await waiting;
        const removed =
          operation === 'erase'
            ? api('POST', '/notes/erase', user, { confirm: 'DELETE' })
            : api('POST', `/workspaces/${workspace.id}/reset`, user, { confirm: workspace.name });
        const client = await getTestClient();
        let isWaiting = false;
        for (let attempt = 0; attempt < 100 && !isWaiting; attempt++) {
          const rows =
            await client`select 1 from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock' and query like '%workspaces%' and query like '%for update%'`;
          isWaiting = rows.length > 0;
          if (!isWaiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(isWaiting).toBe(true);
        resume();
        await pending;
        const result = await removed;
        expect(result.status, JSON.stringify(result.json)).toBe(200);
        expect((await api('GET', `/notes/${id}`, user)).status).toBe(404);
      } finally {
        resume();
        spy.mockRestore();
      }
    });
  }

  it('rolls back the generation with its transaction', async () => {
    const user = `${scope}-rollback`;
    const before = (await api('GET', '/notes/sync?generationAware=1', user))
      .json as unknown as GenerationSyncPage;
    const workspace = (await api('GET', '/workspaces/personal', user)).json.workspace as {
      id: string;
    };
    await expect(
      db.transaction(async (tx) => {
        await generation.advanceNotesGeneration(tx, workspace.id);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const after = (await api('GET', '/notes/sync?generationAware=1', user))
      .json as unknown as GenerationSyncPage;
    expect(after.generation).toBe(before.generation);
  });

  it('reads labels after the lock when erase interleaves with sync setup', async () => {
    const user = `${scope}-old-labels`;
    expect((await api('POST', '/notes/labels', user, { name: 'old label' })).status).toBe(201);
    let resume!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = generation.lockNotesGeneration;
    let held = false;
    const spy = vi.spyOn(generation, 'lockNotesGeneration').mockImplementation(async (...args) => {
      if (!held && args[2] === 'share') {
        held = true;
        reached();
        await gate;
      }
      return original(...args);
    });
    const pending = api('GET', '/notes/sync?generationAware=1', user);
    try {
      await Promise.race([
        waiting,
        pending.then((result) => {
          throw new Error(
            `sync ended before lock: ${result.status} ${JSON.stringify(result.json)}`,
          );
        }),
      ]);
      expect((await api('POST', '/notes/erase', user, { confirm: 'DELETE' })).status).toBe(200);
      resume();
      const result = await pending;
      expect(result.status).toBe(200);
      expect(result.json.labels).toEqual([]);
    } finally {
      resume();
      spy.mockRestore();
    }
  });

  for (const method of ['POST', 'PATCH'] as const) {
    it(`keeps the ${method} readback inside the generation lock`, async () => {
      const user = `${scope}-readback-${method}`;
      const page = (await api('GET', '/notes/sync?generationAware=1', user))
        .json as unknown as GenerationSyncPage;
      if (!page.generation) throw new Error('Missing generation');
      const id = uuidv7();
      const headers = { 'X-Notes-Generation': page.generation };
      if (method === 'PATCH')
        expect((await api('POST', '/notes', user, { id, title: 'original' }, headers)).status).toBe(
          201,
        );
      let resume!: () => void;
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const original = notesRepository.findNoteRow;
      let calls = 0;
      const spy = vi.spyOn(notesRepository, 'findNoteRow').mockImplementation(async (...args) => {
        if (args[2] === id && ++calls === (method === 'POST' ? 1 : 2)) {
          reached();
          await gate;
        }
        return original(...args);
      });
      const pending = api(
        method,
        method === 'POST' ? '/notes' : `/notes/${id}`,
        user,
        { id, title: 'written' },
        headers,
      );
      try {
        await waiting;
        const erased = api('POST', '/notes/erase', user, { confirm: 'DELETE' });
        const client = await getTestClient();
        let isWaiting = false;
        for (let attempt = 0; attempt < 100 && !isWaiting; attempt++) {
          const rows =
            await client`select 1 from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock' and query like '%workspaces%' and query like '%for update%'`;
          isWaiting = rows.length > 0;
          if (!isWaiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(isWaiting).toBe(true);
        resume();
        const result = await pending;
        expect(result.status).toBe(method === 'POST' ? 201 : 200);
        expect(result.json.note).toMatchObject({ id, title: 'written' });
        expect((await erased).status).toBe(200);
      } finally {
        resume();
        spy.mockRestore();
      }
    });
  }

  it('does not broadcast a guarded write rolled back by the outer transaction', async () => {
    const user = `${scope}-broadcast-rollback`;
    const page = (await api('GET', '/notes/sync?generationAware=1', user))
      .json as unknown as GenerationSyncPage;
    if (!page.generation) throw new Error('Missing generation');
    const id = uuidv7();
    const broadcast = vi.spyOn(pageDocs, 'broadcastDocUpdate');
    const read = vi.spyOn(notesRepository, 'findNoteRow').mockImplementationOnce(async () => {
      throw new Error('force rollback');
    });
    try {
      const body = {
        id,
        title: 'rollback',
        blocks: [
          {
            id: uuidv7(),
            parentBlockId: null,
            type: 'paragraph',
            content: { text: 'changed' },
            order: 0,
          },
        ],
      };
      const result = await api('POST', '/notes', user, body, {
        'X-Notes-Generation': page.generation,
      });
      expect(result.status).toBe(500);
      expect(broadcast).not.toHaveBeenCalled();
      expect((await api('GET', `/notes/${id}`, user)).status).toBe(404);
    } finally {
      read.mockRestore();
      broadcast.mockRestore();
    }
  });

  it('reports a committed guarded write even when broadcast fails', async () => {
    const user = `${scope}-broadcast-failure`;
    const page = (await api('GET', '/notes/sync?generationAware=1', user))
      .json as unknown as GenerationSyncPage;
    if (!page.generation) throw new Error('Missing generation');
    const id = uuidv7();
    const broadcast = vi.spyOn(pageDocs, 'broadcastDocUpdate').mockImplementation(() => {
      throw new Error('transport unavailable');
    });
    try {
      const body = {
        id,
        title: 'committed',
        blocks: [
          {
            id: uuidv7(),
            parentBlockId: null,
            type: 'paragraph',
            content: { text: 'changed' },
            order: 0,
          },
        ],
      };
      const result = await api('POST', '/notes', user, body, {
        'X-Notes-Generation': page.generation,
      });
      expect(result.status).toBe(201);
      expect(result.json.note).toMatchObject({ id, title: 'committed' });
      expect((await api('GET', `/notes/${id}`, user)).status).toBe(200);
    } finally {
      broadcast.mockRestore();
    }
  });

  it('rejects a generation header on operations that do not implement the fence', async () => {
    const user = `${scope}-unsupported`;
    const result = await api(
      'POST',
      '/notes/labels',
      user,
      { name: 'unsupported' },
      { 'X-Notes-Generation': 'token' },
    );
    expect(result.status).toBe(400);
    expect(result.json.code).toBe('NOTES_GENERATION_UNSUPPORTED');
    expect(await db.select().from(workspaces).where(eq(workspaces.ownerId, user))).toEqual([]);
  });
});
