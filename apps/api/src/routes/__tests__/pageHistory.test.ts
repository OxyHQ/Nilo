import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { uuidv7 } from '@oxy.so/db';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from 'vitest';

vi.mock('../../db/client.js', () => ({ getDb: () => ({}) }));
vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'history-test-user' };
    next();
  },
}));
vi.mock('../../lib/page-access.js', () => ({ checkPageAccess: vi.fn() }));
vi.mock('../../repositories/pageVersions.js', () => ({
  listPageVersions: vi.fn(),
  findPageVersion: vi.fn(),
  snapshotPage: vi.fn(),
}));
vi.mock('../../repositories/blocks.js', () => ({ listBlocksForPage: vi.fn() }));
vi.mock('../../lib/block-transactions.js', () => ({
  replacePageBlocks: vi.fn(),
  TransactionRejected: class extends Error {},
}));
vi.mock('../../lib/page-docs.js', () => ({ PageDocRejected: class extends Error {} }));
vi.mock('../../lib/page-projection.js', () => ({ projectNow: vi.fn() }));
vi.mock('../../lib/logger.js', () => ({ log: { general: { error: vi.fn() } } }));

const { checkPageAccess } = await import('../../lib/page-access.js');
const { findPageVersion, listPageVersions } = await import('../../repositories/pageVersions.js');
const { default: historyRouter } = await import('../page-history.js');

const access = checkPageAccess as MockedFunction<typeof checkPageAccess>;
const listVersions = listPageVersions as MockedFunction<typeof listPageVersions>;
const readVersion = findPageVersion as MockedFunction<typeof findPageVersion>;

const pageId = uuidv7();
const versionId = uuidv7();
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(historyRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => vi.clearAllMocks());

describe('history authorization boundary', () => {
  it.each(['viewer', 'commenter'] as const)(
    'never reads history when the access owner denies a %s',
    async (role) => {
      access.mockImplementation(async (_req, res, _db, _id, required) => {
        res.status(403).json({ code: 'INSUFFICIENT_ROLE', required, actual: role });
        return null;
      });
      for (const [method, path] of [
        ['GET', `/pages/${pageId}/versions`],
        ['GET', `/pages/${pageId}/versions/${versionId}`],
        ['POST', `/pages/${pageId}/versions/${versionId}/restore`],
      ]) {
        const response = await fetch(`${base}${path}`, { method });
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
          code: 'INSUFFICIENT_ROLE',
          required: 'editor',
          actual: role,
        });
      }
      expect(listPageVersions).not.toHaveBeenCalled();
      expect(findPageVersion).not.toHaveBeenCalled();
      expect(checkPageAccess).toHaveBeenCalledTimes(3);
    },
  );

  it('reads only the authorized page and keeps missing versions scoped to it', async () => {
    access.mockResolvedValue({ role: 'editor' } as NonNullable<
      Awaited<ReturnType<typeof checkPageAccess>>
    >);
    listVersions.mockResolvedValue([]);
    readVersion.mockResolvedValue(undefined);
    const list = await fetch(`${base}/pages/${pageId}/versions`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ versions: [] });
    const detail = await fetch(`${base}/pages/${pageId}/versions/${versionId}`);
    expect(detail.status).toBe(404);
    expect(await detail.json()).toEqual({ error: 'Version not found' });
    expect(listPageVersions).toHaveBeenCalledWith(expect.anything(), pageId);
    expect(findPageVersion).toHaveBeenCalledWith(expect.anything(), pageId, versionId);
    for (const call of access.mock.calls) expect(call.slice(3)).toEqual([pageId, 'editor']);
  });
});
