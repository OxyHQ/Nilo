/**
 * The memory tools (`docs/memories.md`), served at `mcp.memory.nilo.so`. Each one acts on the
 * `memories` database of the personal workspace of the account the token was issued to, and
 * nothing else.
 */
import type { CatalogToolHandler, CatalogToolHandlers } from '@oxy.so/mcp';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import { ensureMemoryDatabase } from '../lib/databases/system.js';
import {
  forgetMemory,
  type MemoryHome,
  MemoryRejected,
  recallMemories,
  remember,
  updateMemory,
} from '../lib/memories.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';
import { executeIdempotently } from './idempotency.js';
import { MEMORIES_CAPABILITY_CATALOG } from './memories.catalog.js';
import {
  invalid,
  limitOf,
  NiloCapabilityError,
  optionalString,
  requiredString,
  type Input,
  type ToolExecutor,
} from './tool-input.js';

async function memoryHome(userId: string): Promise<MemoryHome> {
  const home = await ensurePersonalNotesHome(userId);
  const memories = await ensureMemoryDatabase(getDb() as PgHandle, {
    id: home.workspaceId,
    ownerId: home.ownerId,
  });
  return { workspaceId: home.workspaceId, ownerId: home.ownerId, memories };
}

const translated = (error: unknown): never => {
  if (error instanceof MemoryRejected) {
    throw new NiloCapabilityError(error.code.toLowerCase(), error.message, error.status);
  }
  throw error;
};

function stringList(input: Input, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    invalid(`${key} must be a list of strings`);
  }
  return value as string[];
}

/** The memory fields an agent may write, as one object. */
function memoryFields(input: Input) {
  return {
    ...(typeof input.title === 'string' && { title: input.title }),
    ...(typeof input.detail === 'string' && { detail: input.detail }),
    ...(typeof input.kind === 'string' && { kind: input.kind }),
    ...(typeof input.importance === 'number' && { importance: input.importance }),
    ...(typeof input.pinned === 'boolean' && { pinned: input.pinned }),
    ...(stringList(input, 'tags') !== undefined && { tags: stringList(input, 'tags') }),
  };
}

/** One effectful memory call, once per idempotency key, clients told afterwards. */
async function memoryEffect<Result extends Record<string, unknown>>(
  tool: string,
  input: Input,
  userId: string,
  run: (tx: PgHandle, home: MemoryHome) => Promise<Result>,
): Promise<Result> {
  const home = await memoryHome(userId);
  const execution = await executeIdempotently({
    accountId: userId,
    tool,
    idempotencyKey: requiredString(input, 'idempotencyKey'),
    request: input,
    execute: (tx) => run(tx, home).catch(translated),
  });
  if (!execution.replayed) {
    announceChange({ workspaceId: home.workspaceId, databaseId: home.memories.id });
  }
  return execution.result;
}

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  async recallMemories(input, userId) {
    const home = await memoryHome(userId);
    const minImportance = typeof input.minImportance === 'number' ? input.minImportance : undefined;
    return {
      memories: await recallMemories(getDb() as PgHandle, home, {
        query: optionalString(input, 'query'),
        kind: optionalString(input, 'kind'),
        tags: stringList(input, 'tags'),
        minImportance,
        includeArchived: input.includeArchived === true,
        limit: limitOf(input, 20),
      }),
    };
  },

  remember: (input, userId) =>
    memoryEffect('remember', input, userId, async (tx, home) => {
      const source = optionalString(input, 'source') ?? 'mcp';
      const fields = memoryFields(input);
      if (!fields.title) invalid('title is required');
      const { memory, existed } = await remember(tx, home, {
        ...fields,
        title: fields.title,
        source,
      });
      return { memory: memory as unknown as Record<string, unknown>, existed };
    }),

  updateMemory: (input, userId) =>
    memoryEffect('updateMemory', input, userId, async (tx, home) => ({
      memory: (await updateMemory(
        tx,
        home,
        requiredString(input, 'memoryId'),
        memoryFields(input),
      )) as unknown as Record<string, unknown>,
    })),

  forgetMemory: (input, userId) =>
    memoryEffect('forgetMemory', input, userId, (tx, home) =>
      forgetMemory(tx, home, requiredString(input, 'memoryId'), input.hard === true),
    ),
};

export async function executeMemoryTool(
  toolName: string,
  input: Input,
  userId: string,
): Promise<Record<string, unknown>> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) throw new NiloCapabilityError('unknown_tool', 'Unknown memory tool', 404);
  return executor(input, userId);
}

// Load-time check, as the notes handlers do: a declared MCP tool with no executor, or an
// executor the catalog does not declare, is a refusal to start rather than a silent gap.
{
  const declared = MEMORIES_CAPABILITY_CATALOG.tools
    .filter((tool) => tool.exposure.includes('mcp'))
    .map((tool) => tool.name)
    .sort();
  const implemented = Object.keys(TOOL_EXECUTORS).sort();
  if (declared.join(',') !== implemented.join(',')) {
    throw new Error(
      `Memories catalog handler mismatch: declared=${declared.join(',')} implemented=${implemented.join(',')}`,
    );
  }
}

export const MEMORIES_MCP_HANDLERS: CatalogToolHandlers = Object.fromEntries(
  Object.keys(TOOL_EXECUTORS).map((toolName) => {
    const handler: CatalogToolHandler = async (input, context) => ({
      structuredContent: await executeMemoryTool(
        toolName,
        input,
        context.principal.activeAccountId,
      ),
    });
    return [toolName, handler];
  }),
);
