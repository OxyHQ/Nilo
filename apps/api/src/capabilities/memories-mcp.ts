/**
 * Nilo's agent memories as a remote MCP server, at `https://mcp.memory.nilo.so/mcp` (the
 * catalog's `externalMcp.resource`). Clients sign the person in with Oxy, and each call
 * acts on that person's memories. The transport checks the exact host, so the
 * server answers only there, and introspects the token live with Oxy as Nilo's service.
 */
import { createCatalogMcpHttpService } from '@oxy.so/mcp';
import { log } from '../lib/logger.js';
import { mcpAllowedOrigins } from './notes-mcp.js';
import { MEMORIES_CAPABILITY_CATALOG } from './memories.catalog.js';
import { MEMORIES_MCP_HANDLERS } from './memories.handlers.js';
import { OXY_API_URL, oxyApiTransport } from '../oxy.js';

export function createMemoriesMcpService() {
  return createCatalogMcpHttpService({
    catalog: MEMORIES_CAPABILITY_CATALOG,
    handlers: MEMORIES_MCP_HANDLERS,
    authorizationServer: OXY_API_URL,
    transport: oxyApiTransport,
    allowedOrigins: mcpAllowedOrigins(),
    // The person the token was issued to reads and writes their own memories.
    authorize: async (_input, context) => ({
      allowed: true,
      effectiveAccountId: context.principal.activeAccountId,
    }),
    logger: {
      error(message, error) {
        log.general.error({ err: error }, message);
      },
    },
    serverName: 'nilo-memories-mcp',
  });
}
