/**
 * The notes catalog as a remote MCP server, at `https://mcp.noted.oxy.so/mcp`
 * (the catalog's `externalMcp.resource`): ChatGPT, Claude and other MCP
 * clients sign the person in with Oxy, and each call acts on that person's
 * notes. The transport checks the exact host, so the server answers only
 * there, and introspects the person's token live with Oxy as Nilo's service.
 */
import { createCatalogMcpHttpService } from '@oxy.so/mcp';
import { log } from '../lib/logger.js';
import { NOTES_CAPABILITY_CATALOG } from './notes.catalog.js';
import { NOTES_MCP_HANDLERS } from './notes.handlers.js';
import { invalidateOxyServiceToken, OXY_API_URL, oxyServiceToken } from './oxy-service.js';

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
    getServiceToken: oxyServiceToken,
    invalidateServiceToken: invalidateOxyServiceToken,
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
