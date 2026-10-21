import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import express from 'express';
import { afterAll, beforeAll, beforeEach, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../db/client.js', () => ({ getDb: () => ({}) }));
vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'actor' };
    next();
  },
}));
vi.mock('../../lib/page-access.js', () => ({ checkPageAccess: vi.fn() }));
vi.mock('../../repositories/pageActivity.js', () => ({ listPageActivity: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ log: { general: { error: vi.fn() } } }));
const { checkPageAccess } = await import('../../lib/page-access.js');
const { listPageActivity } = await import('../../repositories/pageActivity.js');
const { default: router } = await import('../page-activity.js');
const access = checkPageAccess as MockedFunction<typeof checkPageAccess>;
const list = listPageActivity as MockedFunction<typeof listPageActivity>;
let server: Server;
let base: string;
const id = uuidv7();
beforeAll(async () => {
  const app = express();
  app.use(router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => vi.clearAllMocks());
it('requires canonical editor access before reading any historical values', async () => {
  access.mockImplementation(async (_req, res, _db, _id, required) => {
    res.status(403).json({ required });
    return null;
  });
  const response = await fetch(`${base}/pages/${id}/activity`);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ required: 'editor' });
  expect(list).not.toHaveBeenCalled();
});
it('passes only the authorized page with bounded default pagination', async () => {
  access.mockResolvedValue({ role: 'editor' } as NonNullable<
    Awaited<ReturnType<typeof checkPageAccess>>
  >);
  list.mockResolvedValue({ items: [], nextCursor: null });
  const response = await fetch(`${base}/pages/${id}/activity`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
  expect(list).toHaveBeenCalledWith(expect.anything(), id, 20, undefined);
  expect(access.mock.calls[0]?.slice(3)).toEqual([id, 'editor']);
});
it('rejects a malformed cursor without reading the repository', async () => {
  access.mockResolvedValue({ role: 'editor' } as NonNullable<
    Awaited<ReturnType<typeof checkPageAccess>>
  >);
  const response = await fetch(`${base}/pages/${id}/activity?cursor=bad`);
  expect(response.status).toBe(400);
  expect(list).not.toHaveBeenCalled();
});
