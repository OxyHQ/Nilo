import type { Express } from 'express';
import type { createNotesMcpService } from './notes-mcp.js';

/** The MCP lane's surface, as the mount uses it. */
export type CatalogMcpLane = Pick<
  ReturnType<typeof createNotesMcpService>,
  'protectedResourceMetadataPath' | 'mcpPath' | 'handleProtectedResourceMetadata' | 'handleMcp'
>;

/**
 * Mount a catalog's MCP lane on the API app (Noted's notes, Nilo's pages). It owns its raw body, its exact host, its
 * OAuth challenge and its origins, so it must be mounted before CORS and the body
 * parser. On the MCP host the root answers like the MCP endpoint (a bare resource URL
 * gets the 401 challenge, not the public welcome JSON), and the root authorization-server
 * path is not served there: the API's metadata names `api.oxy.so` as issuer, which RFC
 * 8414 rejects from any other origin.
 */
export function mountCatalogMcp(app: Express, mcp: CatalogMcpLane, resource: string): void {
  const mcpHost = new URL(resource).host;
  const onMcpHost = (host: string | undefined) => host?.toLowerCase() === mcpHost;
  // Several lanes share one API app, so each answers only on its own host; any other
  // host passes through to the next lane (and, last, to the wrong-host refusal in index.ts).
  app.all(mcp.protectedResourceMetadataPath, (req, res, next) => {
    if (!onMcpHost(req.headers.host)) return next();
    mcp.handleProtectedResourceMetadata(req, res);
  });
  app.all(mcp.mcpPath, (req, res, next) => {
    if (!onMcpHost(req.headers.host)) return next();
    void mcp.handleMcp(req, res);
  });
  app.all('/', (req, res, next) => {
    if (!onMcpHost(req.headers.host)) return next();
    void mcp.handleMcp(req, res);
  });
  app.all('/.well-known/oauth-authorization-server', (req, res, next) => {
    if (!onMcpHost(req.headers.host)) return next();
    res.status(404).json({ error: 'not_found' });
  });
}
