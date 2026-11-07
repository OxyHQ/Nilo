/**
 * The Nilo catalog's tools. Each one acts on the personal workspace of the account
 * the token was issued to, and nothing else: a page of another workspace, a page
 * that is not in this workspace, and a page of Noted's notes databases are all
 * reported as not found. Noted's notes belong to the notes catalog, not this one.
 */
import { blocksToMarkdown, blocksToTree, type NoteBlock } from '@oxy.so/nilo-contracts';
import type { CatalogToolHandler, CatalogToolHandlers } from '@oxy.so/mcp';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import { ensureMemoryDatabase, findSystemDatabase } from '../lib/databases/system.js';
import {
  forgetMemory,
  type MemoryHome,
  MemoryRejected,
  recallMemories,
  remember,
  updateMemory,
} from '../lib/memories.js';
import { executeIdempotently } from './idempotency.js';
import type { PageRow } from '../repositories/pages.js';
import { findPageById, listPages } from '../repositories/pages.js';
import { loadNoteParts, type NotesHome } from '../repositories/notes.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';
import { NILO_CAPABILITY_CATALOG } from './nilo.catalog.js';

export class NiloCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NiloCapabilityError';
  }
}

type Input = Readonly<Record<string, unknown>>;
type ToolExecutor = (input: Input, userId: string) => Promise<Record<string, unknown>>;

const DEFAULT_LIMIT = 50;

function invalid(message: string): never {
  throw new NiloCapabilityError('invalid_input', message, 400);
}

function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) invalid(`${key} is required`);
  return value;
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const limitOf = (input: Input, fallback = DEFAULT_LIMIT) =>
  typeof input.limit === 'number' ? input.limit : fallback;

/** A page as an agent reads its listing: identity and placement, never a body. */
function agentPage(page: PageRow): Record<string, unknown> {
  return {
    id: page.id,
    title: page.title,
    parentId: page.parentId,
    archived: page.archived,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

/**
 * Pages of the workspace that are Nilo's own: not the notes or folders databases
 * (Noted's catalog serves those), not the memories database (the memory tools do),
 * and not templates.
 */
function isWorkspacePage(page: PageRow, home: NotesHome & { memoriesId: string | null }): boolean {
  return (
    page.databaseId !== home.notes.id &&
    page.databaseId !== home.folders.id &&
    (home.memoriesId === null || page.databaseId !== home.memoriesId) &&
    !page.template
  );
}

async function workspaceHome(userId: string): Promise<NotesHome & { memoriesId: string | null }> {
  const home = await ensurePersonalNotesHome(userId);
  const memories = await findSystemDatabase(getDb() as PgHandle, home.workspaceId, 'memories');
  return {
    workspaceId: home.workspaceId,
    ownerId: home.ownerId,
    notes: home.notes,
    folders: home.folders,
    memoriesId: memories?.id ?? null,
  };
}

// ── Memory tools (`docs/memories.md`) ────────────────────────────────

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

const MEMORY_EXECUTORS: Record<string, ToolExecutor> = {
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

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  ...MEMORY_EXECUTORS,

  async listPages(input, userId) {
    const home = await workspaceHome(userId);
    const parent = optionalString(input, 'parentId');
    const rows = await listPages(getDb() as PgHandle, {
      workspaceId: home.workspaceId,
      parentId: parent === undefined ? undefined : parent === 'root' ? null : parent,
      archived: input.includeArchived === true ? undefined : false,
    });
    return {
      pages: rows
        .filter((page) => isWorkspacePage(page, home))
        .slice(0, limitOf(input))
        .map(agentPage),
    };
  },

  async searchPages(input, userId) {
    const query = requiredString(input, 'query').toLocaleLowerCase();
    const home = await workspaceHome(userId);
    const rows = await listPages(getDb() as PgHandle, {
      workspaceId: home.workspaceId,
      archived: false,
    });
    return {
      pages: rows
        .filter(
          (page) => isWorkspacePage(page, home) && page.title.toLocaleLowerCase().includes(query),
        )
        .slice(0, limitOf(input, 20))
        .map(agentPage),
    };
  },

  async readPage(input, userId) {
    const pageId = requiredString(input, 'pageId');
    const db = getDb() as PgHandle;
    const home = await workspaceHome(userId);
    const page = await findPageById(db, pageId);
    if (!page || page.workspaceId !== home.workspaceId || !isWorkspacePage(page, home)) {
      throw new NiloCapabilityError('page_not_found', 'Page not found', 404);
    }
    const parts = await loadNoteParts(db, home.ownerId, [page.id]);
    const blocks: NoteBlock[] = parts.get(page.id)?.blocks ?? [];
    return {
      page: {
        ...agentPage(page),
        body: blocksToMarkdown(blocksToTree(blocks)).trim(),
      },
    };
  },
};

export async function executeNiloTool(
  toolName: string,
  input: Input,
  userId: string,
): Promise<Record<string, unknown>> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) throw new NiloCapabilityError('unknown_tool', 'Unknown Nilo tool', 404);
  return executor(input, userId);
}

// Load-time check, as the notes handlers do: a declared MCP tool with no executor, or an
// executor the catalog does not declare, is a refusal to start rather than a silent gap.
{
  const declared = NILO_CAPABILITY_CATALOG.tools
    .filter((tool) => tool.exposure.includes('mcp'))
    .map((tool) => tool.name)
    .sort();
  const implemented = Object.keys(TOOL_EXECUTORS).sort();
  if (declared.join(',') !== implemented.join(',')) {
    throw new Error(
      `Nilo catalog handler mismatch: declared=${declared.join(',')} implemented=${implemented.join(',')}`,
    );
  }
}

export const NILO_MCP_HANDLERS: CatalogToolHandlers = Object.fromEntries(
  Object.keys(TOOL_EXECUTORS).map((toolName) => {
    const handler: CatalogToolHandler = async (input, context) => ({
      structuredContent: await executeNiloTool(toolName, input, context.principal.activeAccountId),
    });
    return [toolName, handler];
  }),
);
