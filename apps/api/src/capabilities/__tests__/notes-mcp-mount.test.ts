import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountCatalogMcp, type CatalogMcpLane } from '../catalog-mcp-mount.js';

const MCP_HOST = 'mcp.noted.oxy.so';
let server: import('node:http').Server;
let port = 0;

beforeAll(async () => {
  const app = express();
  // Routing only: the lane answers an unauthenticated call with the challenge, as the
  // real transport does (@oxy.so/mcp covers the challenge itself).
  const lane: CatalogMcpLane = {
    protectedResourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
    mcpPath: '/mcp',
    handleProtectedResourceMetadata: (_req, res) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ resource: MCP_HOST }));
    },
    handleMcp: async (_req, res) => {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="x"');
      res.end('{}');
    },
  };
  mountCatalogMcp(app, lane, `https://${MCP_HOST}`);
  // The API's own root answers the public welcome JSON; the MCP host must not reach it.
  app.get('/', (_req, res) => {
    res.json({ message: 'Nilo API' });
  });
  server = app.listen(0);
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// `fetch` drops a Host header, so the request goes through node:http, which keeps it.
function get(
  path: string,
  host: string,
): Promise<{ status: number; www: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          const www = res.headers['www-authenticate'];
          resolve({ status: res.statusCode ?? 0, www: typeof www === 'string' ? www : null, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('mountCatalogMcp', () => {
  it('answers the bare MCP host root with the OAuth challenge, not the welcome JSON', async () => {
    const res = await get('/', MCP_HOST);
    expect(res.status).toBe(401);
    expect(res.www).toContain('resource_metadata=');
    expect(res.body).not.toContain('Nilo API');
  });

  it('keeps the API root on every other host', async () => {
    const res = await get('/', 'api.nilo.so');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Nilo API');
  });

  it('does not serve the root authorization-server path on the MCP host', async () => {
    expect((await get('/.well-known/oauth-authorization-server', MCP_HOST)).status).toBe(404);
  });
});
