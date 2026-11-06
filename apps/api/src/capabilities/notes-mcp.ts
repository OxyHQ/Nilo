/**
 * The notes catalog as a remote MCP server, at `https://mcp.noted.oxy.so/mcp`
 * (the catalog's `externalMcp.resource`): ChatGPT, Claude and other MCP
 * clients sign the person in with Oxy, and each call acts on that person's
 * notes. The transport checks the exact host, so the server answers only
 * there, and introspects the person's token live with Oxy as Nilo's service.
 */
import { createCatalogMcpHttpService } from '@oxy.so/mcp';
import type { Express } from 'express';
import { log } from '../lib/logger.js';
import { NOTES_CAPABILITY_CATALOG } from './notes.catalog.js';
import { NOTES_MCP_HANDLERS } from './notes.handlers.js';
import { OXY_API_URL, oxyApiTransport } from '../oxy.js';

const DEFAULT_ALLOWED_ORIGINS = ['https://chatgpt.com', 'https://claude.ai'] as const;

export function mcpAllowedOrigins(configured = process.env.MCP_ALLOWED_ORIGINS): string[] {
  return [
    ...new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...(configured ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
  ];
}

export function createNotesMcpService() {
  return createCatalogMcpHttpService({
    catalog: NOTES_CAPABILITY_CATALOG,
    handlers: NOTES_MCP_HANDLERS,
    authorizationServer: OXY_API_URL,
    transport: oxyApiTransport,
    allowedOrigins: mcpAllowedOrigins(),
    // The person the token was issued to acts on their own notes.
    authorize: async (_input, context) => ({
      allowed: true,
      effectiveAccountId: context.principal.activeAccountId,
    }),
    logger: {
      error(message, error) {
        log.general.error({ err: error }, message);
      },
    },
    serverName: 'noted-mcp',
  });
}

/**
 * Mount the notes MCP lane on the API app. It owns its raw body, its exact host, its
 * OAuth challenge and its origins, so it must be mounted before CORS and the body
 * parser. On the MCP host the root answers like the MCP endpoint (a bare resource URL
 * gets the 401 challenge, not the public welcome JSON), and the root authorization-server
 * path is not served there: the API's metadata names `api.oxy.so` as issuer, which RFC
 * 8414 rejects from any other origin.
 */
export function mountNotesMcp(app: Express, mcp: ReturnType<typeof createNotesMcpService>): void {
  const mcpHost = new URL(NOTES_CAPABILITY_CATALOG.externalMcp?.resource ?? '').host;
  const onMcpHost = (host: string | undefined) => host?.toLowerCase() === mcpHost;
  app.all(mcp.protectedResourceMetadataPath, (req, res) => {
    mcp.handleProtectedResourceMetadata(req, res);
  });
  app.all(mcp.mcpPath, (req, res) => {
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
