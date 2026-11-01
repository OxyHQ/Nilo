import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiCors } from '../api-cors.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(createApiCors(['https://noted.example']));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
describe('API preflight', () => {
  it('allows the generation header for an allowed origin', async () => {
    const res = await fetch(`${base}/notes`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://noted.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, x-notes-generation',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://noted.example');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-notes-generation',
    );
  });
  it('does not allow an unknown origin', async () => {
    const res = await fetch(`${base}/notes`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-notes-generation',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
