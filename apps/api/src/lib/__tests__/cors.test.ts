import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiCors, socketCors } from '../cors.js';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(apiCors);
  app.get('/notes', (_req, res) => res.json({ ok: true }));
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

const preflight = (origin: string) =>
  fetch(`${base}/notes`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-notes-generation',
    },
  });

describe('API CORS', () => {
  it('allows Noted, with the generation header it sends', async () => {
    const res = await preflight('https://noted.oxy.so');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://noted.oxy.so');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-notes-generation',
    );
  });

  it('exposes the download name and the retry delay', async () => {
    const res = await fetch(`${base}/notes`, { headers: { Origin: 'https://nilo.so' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://nilo.so');
    expect(res.headers.get('access-control-expose-headers')).toBe(
      'Content-Disposition, Retry-After',
    );
  });

  it('admits no other origin, and never echoes one back', async () => {
    for (const origin of ['https://untrusted.example', 'https://nilo.so.evil.example', 'null']) {
      const res = await preflight(origin);
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull();
    }
  });
});

describe('socket CORS', () => {
  const admits = (origin: string | undefined) =>
    new Promise<boolean>((resolve) =>
      socketCors.allowRequest(
        { headers: origin === undefined ? {} : { origin } },
        (_error, success) => resolve(success),
      ),
    );

  it('admits the same browsers as HTTP, and a native client with no Origin', async () => {
    expect(await admits('https://nilo.so')).toBe(true);
    expect(await admits('http://localhost:8081')).toBe(true);
    expect(await admits(undefined)).toBe(true);
    expect(await admits('https://untrusted.example')).toBe(false);
  });
});
