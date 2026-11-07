/**
 * Nilo's capability catalog: the pages of a person's own workspace as tools that
 * Alia and MCP clients (`mcp.nilo.so`) call. It is read-only in this version: a
 * client can find and read a page, never change one. Every tool acts only on the
 * personal workspace of the account the token was issued to; a page outside it is
 * reported as not found, so the catalog never reveals another workspace's pages.
 *
 * A page's `body` is Markdown on the way out; Nilo stores blocks.
 */
import type { AppCapabilityCatalog, CatalogTool } from '@oxy.so/contracts';

const TOOL_VERSION = '1.0.0';

const identifier = { type: 'string', minLength: 1, maxLength: 255 } as const;
const pageObject = { type: 'object', additionalProperties: true } as const;

type ToolInput = Omit<
  CatalogTool,
  | 'version'
  | 'capabilityPackage'
  | 'requiredCapabilities'
  | 'resourceTypes'
  | 'effect'
  | 'idempotency'
  | 'rollback'
  | 'exposure'
  | 'limitKeys'
>;

function readTool(input: ToolInput, resourceTypes: string[]): CatalogTool {
  return {
    ...input,
    version: TOOL_VERSION,
    capabilityPackage: 'read',
    requiredCapabilities: ['pages.read'],
    resourceTypes,
    effect: 'read',
    idempotency: 'none',
    rollback: 'none',
    exposure: ['internal', 'mcp'],
    limitKeys: [],
  };
}

export const NILO_CAPABILITY_CATALOG: AppCapabilityCatalog = {
  schemaVersion: '1',
  appId: 'nilo',
  version: '1.0.0',
  audience: 'oxy-nilo-api',
  internalBaseUrl: 'https://api.nilo.so',
  externalMcp: { resource: 'https://mcp.nilo.so' },
  accountResourceType: 'nilo_account',
  // No events yet: this version publishes nothing to Alia.
  events: [],
  tools: [
    readTool(
      {
        name: 'listPages',
        description:
          'List pages in the personal workspace. Omit parentId for every page, or pass "root" for top-level pages, or a page id for its children.',
        inputSchema: {
          type: 'object',
          properties: {
            parentId: identifier,
            includeArchived: { type: 'boolean' },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { pages: { type: 'array', items: pageObject } },
          required: ['pages'],
          additionalProperties: false,
        },
        invocation: { method: 'GET', path: '/_oxy/capabilities/listPages' },
      },
      ['nilo_account', 'page'],
    ),
    readTool(
      {
        name: 'searchPages',
        description: 'Find pages in the personal workspace whose title contains the query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 200 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
          required: ['query'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { pages: { type: 'array', items: pageObject } },
          required: ['pages'],
          additionalProperties: false,
        },
        invocation: { method: 'GET', path: '/_oxy/capabilities/searchPages' },
      },
      ['nilo_account', 'page'],
    ),
    readTool(
      {
        name: 'readPage',
        description:
          'Read one page of the personal workspace: its title and its content as Markdown.',
        inputSchema: {
          type: 'object',
          properties: { pageId: identifier },
          required: ['pageId'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { page: pageObject },
          required: ['page'],
          additionalProperties: false,
        },
        invocation: { method: 'GET', path: '/_oxy/capabilities/readPage' },
      },
      ['nilo_account', 'page'],
    ),
  ],
};
