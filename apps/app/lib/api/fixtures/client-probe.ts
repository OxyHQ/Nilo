import assert from 'node:assert/strict';
import { isAxiosError } from 'axios';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OxyServices } from '@oxy.so/core';

let release: (() => void) | undefined;
let arrived: (() => void) | undefined;
const token = (userId: string, exp = 2_000_000_000) =>
  `e30.${Buffer.from(JSON.stringify({ userId, sessionId: userId, exp })).toString('base64url')}.fixture`;
const server = createServer(async (req, res) => {
  if (req.url === '/held') {
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    arrived?.();
    await ready;
  }
  res.writeHead(req.url === '/private' && !req.headers.authorization ? 401 : 200, {
    'content-type': 'application/json',
  });
  res.end(
    JSON.stringify({
      bearer: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null,
    }),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.EXPO_PUBLIC_API_URL = origin;
const api = await import('../client');
const oxy = new OxyServices({ baseURL: origin });
api.bindApiClient(oxy);
try {
  const response = await api.default.get('/public', {
    headers: { Authorization: 'Bearer forged', Cookie: 'ambient=1' },
  });
  assert.deepEqual(response.data, { bearer: null, cookie: null });
  await assert.rejects(
    api.default.get('/private'),
    (error: unknown) => isAxiosError(error) && error.response?.status === 401,
  );
  oxy.session.setAccessToken(token('A', 1));
  oxy.http.setAuthRefreshHandler(async () => token('A'));
  assert.equal(await api.socketAccessToken(new AbortController().signal), token('A'));
  assert.equal(api.hasApiSession(), true);
  assert.equal((await api.default.get('/private')).data.bearer, `Bearer ${token('A')}`);
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const pending = api.default.get('/held');
  await ready;
  oxy.session.setAccessToken(token('B'));
  release?.();
  await assert.rejects(pending, { code: 'AUTH_SESSION_CHANGED' });
  assert.equal((await api.default.get('/private')).data.bearer, `Bearer ${token('B')}`);
  let changes = 0;
  const unsubscribe = api.onApiSessionContextChange(() => {
    changes++;
  });
  oxy.session.clear();
  assert.equal(changes, 1);
  assert.equal(api.hasApiSession(), false);
  await assert.rejects(api.socketAccessToken(new AbortController().signal), /active Oxy session/);
  unsubscribe();
  api.releaseApiClient(oxy);
  await assert.rejects(api.default.get('/public'), /provider has not bound/);
  api.bindApiClient(oxy);
  assert.equal((await api.default.get('/public')).data.bearer, null);
  api.releaseApiClient(oxy);
  process.stdout.write('NILO_SHARED_TRANSPORT_OK\n');
} finally {
  release?.();
  oxy.dispose();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
