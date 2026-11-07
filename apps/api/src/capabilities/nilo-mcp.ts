/**
 * Nilo's workspace catalog as a remote MCP server, at `https://mcp.nilo.so/mcp` (the
 * catalog's `externalMcp.resource`). Clients sign the person in with Oxy, and each call
 * acts on that person's personal workspace. The transport checks the exact host, so the
 * server answers only there, and introspects the token live with Oxy as Nilo's service.
 */
import { createCatalogMcpHttpService } from '@oxy.so/mcp';
import { log } from '../lib/logger.js';
import { mcpAllowedOrigins } from './notes-mcp.js';
import { NILO_CAPABILITY_CATALOG } from './nilo.catalog.js';
import { NILO_MCP_HANDLERS } from './nilo.handlers.js';
import { OXY_API_URL, oxyApiTransport } from '../oxy.js';

export function createNiloMcpService() {
  return createCatalogMcpHttpService({
    catalog: NILO_CAPABILITY_CATALOG,
    handlers: NILO_MCP_HANDLERS,
    authorizationServer: OXY_API_URL,
    transport: oxyApiTransport,
    allowedOrigins: mcpAllowedOrigins(),
    // The person the token was issued to reads their own workspace.
    authorize: async (_input, context) => ({
      allowed: true,
      effectiveAccountId: context.principal.activeAccountId,
    }),
    logger: {
      error(message, error) {
        log.general.error({ err: error }, message);
      },
    },
    serverName: 'nilo-mcp',
  });
}
