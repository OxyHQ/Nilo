/**
 * The agent-memory catalog: the account's `memories` database as tools that Alia and MCP clients
 * (`mcp.memory.nilo.so`) call (`docs/memories.md`). It is its own catalog and MCP server, apart
 * from the workspace's pages (`nilo.catalog.ts`), so a client asks for memory access on its own
 * and never sees page tools by accident. MCP only: Nilo's internal capability route serves the
 * notes catalog, so Alia reaches these through the MCP server. Every tool acts only on the
 * `memories` database of the personal workspace of the account the token was issued to.
 */
import type { AppCapabilityCatalog, CatalogTool } from '@oxy.so/contracts';

const TOOL_VERSION = '1.0.0';

const identifier = { type: 'string', minLength: 1, maxLength: 255 } as const;
const memoryObject = { type: 'object', additionalProperties: true } as const;
const idempotencyKey = {
  type: 'string',
  minLength: 1,
  maxLength: 255,
  description: 'Stable caller-generated key for retry-safe execution.',
} as const;
const memoryFields = {
  title: {
    type: 'string',
    minLength: 1,
    maxLength: 300,
    description: 'One atomic fact, a single self-contained sentence.',
  },
  detail: { type: 'string', maxLength: 8_000, description: 'Optional context for the fact.' },
  kind: {
    type: 'string',
    maxLength: 40,
    description: 'preference, fact, episode, procedure or project.',
  },
  tags: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 40 }, maxItems: 12 },
  importance: { type: 'integer', minimum: 1, maximum: 5, description: '1 trivia, 5 essential.' },
  pinned: { type: 'boolean' },
} as const;

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

function recallTool(input: ToolInput, resourceTypes: string[]): CatalogTool {
  return {
    ...input,
    version: TOOL_VERSION,
    capabilityPackage: 'read',
    requiredCapabilities: ['memories.read'],
    resourceTypes,
    effect: 'read',
    idempotency: 'none',
    rollback: 'none',
    exposure: ['mcp'],
    limitKeys: [],
  };
}

function memoryWriteTool(
  input: ToolInput,
  options: { capabilityPackage: 'create' | 'administer'; rollback: 'manual' | 'supported' },
): CatalogTool {
  return {
    ...input,
    version: TOOL_VERSION,
    capabilityPackage: options.capabilityPackage,
    requiredCapabilities: ['memories.write'],
    resourceTypes: ['nilo_account', 'memory'],
    effect: 'write',
    idempotency: 'required',
    rollback: options.rollback,
    exposure: ['mcp'],
    limitKeys: [],
  };
}

const memoryOutput = {
  type: 'object',
  properties: { memory: memoryObject },
  required: ['memory'],
  additionalProperties: false,
} as const;

export const MEMORIES_CAPABILITY_CATALOG: AppCapabilityCatalog = {
  schemaVersion: '1',
  appId: 'nilo-memories',
  version: '1.0.0',
  audience: 'oxy-nilo-api',
  internalBaseUrl: 'https://api.nilo.so',
  externalMcp: { resource: 'https://mcp.memory.nilo.so' },
  accountResourceType: 'nilo_account',
  // No events: this catalog publishes nothing to Alia.
  events: [],
  tools: [
    recallTool(
      {
        name: 'recallMemories',
        description:
          "Recall the person's long-term memories, most relevant first. Call it before answering anything personal, and with no query to list the most important ones. Words are matched against each memory's title, tags and detail.",
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 500 },
            kind: memoryFields.kind,
            tags: memoryFields.tags,
            minImportance: memoryFields.importance,
            includeArchived: { type: 'boolean' },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { memories: { type: 'array', items: memoryObject } },
          required: ['memories'],
          additionalProperties: false,
        },
        // POST: a GET input can only be a scalar, and a recall filters by a list of tags.
        invocation: { method: 'POST', path: '/_oxy/capabilities/recallMemories' },
      },
      ['nilo_account', 'memory'],
    ),
    memoryWriteTool(
      {
        name: 'remember',
        description:
          'Save one durable fact about the person (a preference, a decision, a project detail). Save atomic facts, not conversation. Saying the same fact again refreshes it instead of duplicating it. Never save secrets or credentials.',
        inputSchema: {
          type: 'object',
          properties: {
            idempotencyKey,
            ...memoryFields,
            source: {
              type: 'string',
              maxLength: 80,
              description: 'Which agent or client is saving this.',
            },
          },
          required: ['idempotencyKey', 'title'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { memory: memoryObject, existed: { type: 'boolean' } },
          required: ['memory', 'existed'],
          additionalProperties: false,
        },
        invocation: { method: 'POST', path: '/_oxy/capabilities/remember' },
      },
      { capabilityPackage: 'create', rollback: 'supported' },
    ),
    memoryWriteTool(
      {
        name: 'updateMemory',
        description: 'Correct a memory: change its title, detail, kind, tags, importance or pin.',
        inputSchema: {
          type: 'object',
          properties: { idempotencyKey, memoryId: identifier, ...memoryFields },
          required: ['idempotencyKey', 'memoryId'],
          additionalProperties: false,
        },
        outputSchema: memoryOutput,
        invocation: { method: 'PATCH', path: '/_oxy/capabilities/updateMemory' },
      },
      { capabilityPackage: 'create', rollback: 'manual' },
    ),
    memoryWriteTool(
      {
        name: 'forgetMemory',
        description:
          'Forget a memory that is wrong or no longer true. It is archived (the person can restore it) unless hard is true, which deletes it for good.',
        inputSchema: {
          type: 'object',
          properties: { idempotencyKey, memoryId: identifier, hard: { type: 'boolean' } },
          required: ['idempotencyKey', 'memoryId'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { id: identifier, deleted: { type: 'boolean' } },
          required: ['id', 'deleted'],
          additionalProperties: false,
        },
        invocation: { method: 'DELETE', path: '/_oxy/capabilities/forgetMemory' },
      },
      { capabilityPackage: 'administer', rollback: 'manual' },
    ),
  ],
};
