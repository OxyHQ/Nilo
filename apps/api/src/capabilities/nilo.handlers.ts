/**
 * The Nilo catalog's tools. Each one acts on the personal workspace of the account
 * the token was issued to, and nothing else: a page of another workspace, a page
 * that is not in this workspace, and a page of Noted's notes databases are all
 * reported as not found. Noted's notes belong to the notes catalog, not this one.
 */
import { blocksToMarkdown, blocksToTree, type NoteBlock } from '@oxy.so/nilo-contracts';
import type { CatalogToolHandler, CatalogToolHandlers } from '@oxy.so/mcp';
import { getDb, type PgHandle } from '../db/client.js';
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
 * (Noted's catalog serves those), and not templates.
 */
function isWorkspacePage(page: PageRow, home: NotesHome): boolean {
  return page.databaseId !== home.notes.id && page.databaseId !== home.folders.id && !page.template;
}

async function workspaceHome(userId: string): Promise<NotesHome> {
  const home = await ensurePersonalNotesHome(userId);
  return {
    workspaceId: home.workspaceId,
    ownerId: home.ownerId,
    notes: home.notes,
    folders: home.folders,
  };
}

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
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
