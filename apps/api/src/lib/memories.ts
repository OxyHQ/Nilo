/**
 * Agent memory (`docs/memories.md`): the rows of the `memories` system
 * database of a personal workspace. A memory is one atomic fact (the title),
 * an optional detail, a kind, tags, an importance, and where it came from.
 *
 * Nilo only stores and ranks. It makes no embeddings and calls no model: an
 * agent that writes a good title, tags and detail is what makes a memory
 * findable, and anything smarter (embeddings, summaries) belongs to Alia/Oxy,
 * never here (`AGENTS.md`, `inferenceBoundary.test.ts`).
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { databases, type DatabaseSchema, type SelectOption } from '../db/schema/databases.js';
import { pages } from '../db/schema/pages.js';
import { findDatabaseById, type DatabaseRecord } from '../repositories/databases.js';
import {
  deletePageTree,
  findPageById,
  nextDatabaseRowOrder,
  type PageRow,
  updatePage,
} from '../repositories/pages.js';
import { createRow } from './databases/rows.js';
import { MEMORY_PROPERTY } from './databases/system.js';

export class MemoryRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MemoryRejected';
  }
}

export interface MemoryHome {
  workspaceId: string;
  ownerId: string;
  memories: DatabaseRecord;
}

export interface Memory {
  id: string;
  title: string;
  detail: string;
  kind: string | null;
  tags: string[];
  source: string;
  importance: number;
  pinned: boolean;
  archived: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryWrite {
  title?: string;
  detail?: string;
  kind?: string;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
  source?: string;
}

export const MEMORY_LIMITS = {
  title: 300,
  detail: 8_000,
  tag: 40,
  tags: 12,
  source: 80,
  importanceMin: 1,
  importanceMax: 5,
  defaultImportance: 3,
  /** Rows a recall reads: a personal memory is far smaller, and a bound keeps a recall cheap. */
  scan: 2_000,
} as const;

/** Accent- and case-insensitive, whitespace collapsed. */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const fingerprintOf = (title: string): string =>
  createHash('sha256').update(fold(title)).digest('hex').slice(0, 32);

const slug = (tag: string): string =>
  fold(tag)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

// ── Reading a row as a memory ────────────────────────────────────────

function textOf(properties: Record<string, unknown>, id: string): string {
  const value = properties[id] as { text?: unknown } | undefined;
  return typeof value?.text === 'string' ? value.text : '';
}

export function toMemory(page: PageRow, schema: DatabaseSchema): Memory {
  const properties = page.properties as Record<string, unknown>;
  const options = (id: string): SelectOption[] =>
    schema.properties.find((p) => p.id === id)?.config?.options ?? [];
  const kindId = (properties[MEMORY_PROPERTY.kind] as { optionId?: unknown } | undefined)?.optionId;
  const tagIds = (properties[MEMORY_PROPERTY.tags] as { optionIds?: unknown } | undefined)
    ?.optionIds;
  const tagNames = new Map(options(MEMORY_PROPERTY.tags).map((o) => [o.id, o.name]));
  const kinds = new Map(options(MEMORY_PROPERTY.kind).map((o) => [o.id, o.name]));
  const importance = (properties[MEMORY_PROPERTY.importance] as { number?: unknown } | undefined)
    ?.number;
  const lastUsed = (properties[MEMORY_PROPERTY.lastUsed] as { start?: unknown } | undefined)?.start;
  return {
    id: page.id,
    title: page.title,
    detail: textOf(properties, MEMORY_PROPERTY.detail),
    kind: typeof kindId === 'string' ? (kinds.get(kindId) ?? kindId) : null,
    tags: Array.isArray(tagIds)
      ? tagIds.flatMap((id) => {
          const name = typeof id === 'string' ? tagNames.get(id) : undefined;
          return name === undefined ? [] : [name];
        })
      : [],
    source: textOf(properties, MEMORY_PROPERTY.source),
    importance: typeof importance === 'number' ? importance : MEMORY_LIMITS.defaultImportance,
    pinned:
      (properties[MEMORY_PROPERTY.pinned] as { checked?: unknown } | undefined)?.checked === true,
    archived: page.archived,
    lastUsedAt: typeof lastUsed === 'string' ? lastUsed : null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

// ── Validation ───────────────────────────────────────────────────────

function cleanWrite(write: MemoryWrite): MemoryWrite {
  const out: MemoryWrite = { ...write };
  if (out.title !== undefined) {
    out.title = out.title.trim();
    if (!out.title) throw new MemoryRejected(400, 'A memory needs a title', 'TITLE_REQUIRED');
    if (out.title.length > MEMORY_LIMITS.title) {
      throw new MemoryRejected(
        400,
        'The title is too long: keep one atomic fact',
        'TITLE_TOO_LONG',
      );
    }
  }
  if (out.detail !== undefined && out.detail.length > MEMORY_LIMITS.detail) {
    throw new MemoryRejected(400, 'The detail is too long', 'DETAIL_TOO_LONG');
  }
  if (out.importance !== undefined) {
    const { importanceMin: min, importanceMax: max } = MEMORY_LIMITS;
    if (!Number.isInteger(out.importance) || out.importance < min || out.importance > max) {
      throw new MemoryRejected(400, `importance is a whole number ${min}-${max}`, 'BAD_IMPORTANCE');
    }
  }
  if (out.tags !== undefined) {
    const tags = [...new Map(out.tags.map((t) => [slug(t), t.trim()])).entries()].filter(
      ([key, name]) => key && name,
    );
    if (tags.length > MEMORY_LIMITS.tags || tags.some(([, n]) => n.length > MEMORY_LIMITS.tag)) {
      throw new MemoryRejected(400, 'Too many tags, or a tag is too long', 'BAD_TAGS');
    }
    out.tags = tags.map(([, name]) => name);
  }
  if (out.source !== undefined) out.source = out.source.trim().slice(0, MEMORY_LIMITS.source);
  return out;
}

// ── Schema: tags are made on demand, kinds must exist ────────────────

/**
 * Add the tags that do not exist yet to the Tags property, under the
 * database's row lock so concurrent writers do not drop each other's tags.
 * Returns the option id of each tag, in order.
 */
async function ensureTags(
  tx: PgHandle,
  home: MemoryHome,
  tags: string[],
): Promise<{ ids: string[]; schema: DatabaseSchema }> {
  await tx
    .select({ id: databases.id })
    .from(databases)
    .where(eq(databases.id, home.memories.id))
    .for('update');
  const fresh = await findDatabaseById(tx, home.memories.id);
  if (!fresh) throw new Error(`memories database ${home.memories.id} vanished`);
  const property = fresh.propertiesSchema.properties.find((p) => p.id === MEMORY_PROPERTY.tags);
  if (!property) throw new Error('the memories database has no Tags property');
  const options = property.config?.options ?? [];
  let changed = false;
  const ids = tags.map((name) => {
    const existing = options.find((o) => slug(o.name) === slug(name));
    if (existing) return existing.id;
    const option: SelectOption = { id: `tag-${slug(name)}`, name, color: 'default' };
    options.push(option);
    changed = true;
    return option.id;
  });
  if (changed) {
    property.config = { ...property.config, options };
    await tx
      .update(databases)
      .set({ propertiesSchema: fresh.propertiesSchema })
      .where(eq(databases.id, fresh.id));
  }
  home.memories = { ...fresh };
  return { ids, schema: fresh.propertiesSchema };
}

function kindId(home: MemoryHome, kind: string): string {
  const options =
    home.memories.propertiesSchema.properties.find((p) => p.id === MEMORY_PROPERTY.kind)?.config
      ?.options ?? [];
  const found = options.find((o) => o.id === kind || fold(o.name) === fold(kind));
  if (!found) {
    throw new MemoryRejected(
      400,
      `Unknown kind "${kind}"; use one of: ${options.map((o) => o.id).join(', ')}`,
      'UNKNOWN_KIND',
    );
  }
  return found.id;
}

async function propertiesOf(
  tx: PgHandle,
  home: MemoryHome,
  write: MemoryWrite,
): Promise<Record<string, unknown>> {
  const properties: Record<string, unknown> = {};
  if (write.title !== undefined) {
    properties[MEMORY_PROPERTY.name] = { text: write.title };
    properties[MEMORY_PROPERTY.fingerprint] = { text: fingerprintOf(write.title) };
  }
  if (write.detail !== undefined) properties[MEMORY_PROPERTY.detail] = { text: write.detail };
  if (write.kind !== undefined)
    properties[MEMORY_PROPERTY.kind] = { optionId: kindId(home, write.kind) };
  if (write.source !== undefined) properties[MEMORY_PROPERTY.source] = { text: write.source };
  if (write.importance !== undefined)
    properties[MEMORY_PROPERTY.importance] = { number: write.importance };
  if (write.pinned !== undefined) properties[MEMORY_PROPERTY.pinned] = { checked: write.pinned };
  if (write.tags !== undefined) {
    const { ids } = await ensureTags(tx, home, write.tags);
    properties[MEMORY_PROPERTY.tags] = { optionIds: [...new Set(ids)] };
  }
  return properties;
}

// ── Reads ────────────────────────────────────────────────────────────

async function findRow(db: PgHandle, home: MemoryHome, id: string): Promise<PageRow | null> {
  const row = await findPageById(db, id);
  return row && row.databaseId === home.memories.id ? row : null;
}

async function findByFingerprint(
  db: PgHandle,
  home: MemoryHome,
  fingerprint: string,
): Promise<PageRow | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.databaseId, home.memories.id),
        sql`${pages.properties} -> ${MEMORY_PROPERTY.fingerprint} ->> 'text' = ${fingerprint}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function readMemory(
  db: PgHandle,
  home: MemoryHome,
  id: string,
): Promise<Memory | null> {
  const row = await findRow(db, home, id);
  return row ? toMemory(row, home.memories.propertiesSchema) : null;
}

// ── Writes ───────────────────────────────────────────────────────────

/**
 * Remember a fact. The same fact (the same title, ignoring case and accents)
 * is stored once: saying it again refreshes it, raises its importance if the
 * new one is higher, and brings it back if it was archived.
 */
export async function remember(
  tx: PgHandle,
  home: MemoryHome,
  input: MemoryWrite & { title: string },
): Promise<{ memory: Memory; existed: boolean }> {
  const write = cleanWrite(input);
  const now = new Date().toISOString();
  const existing = await findByFingerprint(tx, home, fingerprintOf(write.title as string));
  if (existing) {
    const known = toMemory(existing, home.memories.propertiesSchema);
    const patch: MemoryWrite = {
      ...(write.detail !== undefined && { detail: write.detail }),
      ...(write.kind !== undefined && { kind: write.kind }),
      ...(write.source !== undefined && { source: write.source }),
      ...(write.pinned !== undefined && { pinned: write.pinned }),
      importance:
        Math.max(known.importance, write.importance ?? 0) || MEMORY_LIMITS.defaultImportance,
      ...(write.tags !== undefined && {
        tags: [...new Map([...known.tags, ...write.tags].map((t) => [slug(t), t])).values()],
      }),
    };
    const properties = await propertiesOf(tx, home, patch);
    properties[MEMORY_PROPERTY.lastUsed] = { start: now, end: null, includeTime: true };
    const row = await updatePage(tx, existing.id, {
      mergeProperties: properties as never,
      archived: false,
      lastEditedBy: home.ownerId,
    });
    if (!row) throw new MemoryRejected(404, 'Memory not found', 'MEMORY_NOT_FOUND');
    return { memory: toMemory(row, home.memories.propertiesSchema), existed: true };
  }
  const properties = await propertiesOf(tx, home, {
    ...write,
    importance: write.importance ?? MEMORY_LIMITS.defaultImportance,
    pinned: write.pinned ?? false,
    tags: write.tags ?? [],
  });
  properties[MEMORY_PROPERTY.lastUsed] = { start: now, end: null, includeTime: true };
  const row = await createRow(tx, home.memories, {
    workspaceId: home.workspaceId,
    parentId: null,
    title: write.title as string,
    ownerId: home.ownerId,
    order: await nextDatabaseRowOrder(tx, home.memories.id),
    properties: properties as never,
  });
  return { memory: toMemory(row, home.memories.propertiesSchema), existed: false };
}

export async function updateMemory(
  tx: PgHandle,
  home: MemoryHome,
  id: string,
  input: MemoryWrite,
): Promise<Memory> {
  const write = cleanWrite(input);
  if (!(await findRow(tx, home, id))) {
    throw new MemoryRejected(404, 'Memory not found', 'MEMORY_NOT_FOUND');
  }
  if (Object.keys(write).length === 0) {
    throw new MemoryRejected(400, 'No memory fields to update', 'NOTHING_TO_UPDATE');
  }
  if (write.title !== undefined) {
    const clash = await findByFingerprint(tx, home, fingerprintOf(write.title));
    if (clash && clash.id !== id) {
      throw new MemoryRejected(409, 'Another memory already says that', 'MEMORY_EXISTS');
    }
  }
  const row = await updatePage(tx, id, {
    ...(write.title !== undefined && { title: write.title }),
    mergeProperties: (await propertiesOf(tx, home, write)) as never,
    lastEditedBy: home.ownerId,
  });
  if (!row) throw new MemoryRejected(404, 'Memory not found', 'MEMORY_NOT_FOUND');
  return toMemory(row, home.memories.propertiesSchema);
}

/** Archive a memory (it stops being recalled, and can be restored), or delete it for good. */
export async function forgetMemory(
  tx: PgHandle,
  home: MemoryHome,
  id: string,
  hard: boolean,
): Promise<{ id: string; deleted: boolean }> {
  if (!(await findRow(tx, home, id))) {
    throw new MemoryRejected(404, 'Memory not found', 'MEMORY_NOT_FOUND');
  }
  if (hard) {
    await deletePageTree(tx, id);
    return { id, deleted: true };
  }
  await updatePage(tx, id, { archived: true, lastEditedBy: home.ownerId });
  return { id, deleted: false };
}

// ── Recall ───────────────────────────────────────────────────────────

export interface RecallFilter {
  query?: string;
  kind?: string;
  tags?: string[];
  minImportance?: number;
  includeArchived?: boolean;
  limit: number;
}

const DAY_MS = 86_400_000;

/**
 * How well a memory answers a query, 0..1: each query word found in the title
 * (3), tags (2) or detail (1), over the best a memory could score. A memory
 * that contains none of the words scores 0 and is not recalled.
 */
export function textScore(memory: Memory, words: string[]): number {
  if (words.length === 0) return 0;
  const title = fold(memory.title);
  const tags = fold(memory.tags.join(' '));
  const detail = fold(memory.detail);
  let score = 0;
  for (const word of words) {
    if (title.includes(word)) score += 3;
    if (tags.includes(word)) score += 2;
    if (detail.includes(word)) score += 1;
  }
  return score / (words.length * 6);
}

/** Relevance first; importance, pinning and recency break ties and lift what matters. */
export function rank(memory: Memory, words: string[], now: number): number {
  const age = (now - Date.parse(memory.lastUsedAt ?? memory.updatedAt)) / DAY_MS;
  const recency = Math.exp(-Math.max(age, 0) / 90);
  const prior = (memory.importance / 5) * 0.3 + (memory.pinned ? 0.2 : 0) + recency * 0.2;
  return textScore(memory, words) * 2 + prior;
}

export async function recallMemories(
  db: PgHandle,
  home: MemoryHome,
  filter: RecallFilter,
  now = Date.now(),
): Promise<Memory[]> {
  const rows = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.databaseId, home.memories.id),
        eq(pages.template, false),
        ...(filter.includeArchived ? [] : [eq(pages.archived, false)]),
      ),
    )
    .orderBy(sql`${pages.updatedAt} desc`)
    .limit(MEMORY_LIMITS.scan);
  const schema = home.memories.propertiesSchema;
  const words = [
    ...new Set(
      fold(filter.query ?? '')
        .split(' ')
        .filter((w) => w.length > 1),
    ),
  ];
  const wantedKind = filter.kind ? fold(filter.kind) : null;
  const wantedTags = (filter.tags ?? []).map(slug);
  return rows
    .map((row) => toMemory(row, schema))
    .filter((m) => {
      if (wantedKind && fold(m.kind ?? '') !== wantedKind) return false;
      if (filter.minImportance !== undefined && m.importance < filter.minImportance) return false;
      if (wantedTags.length && !wantedTags.every((t) => m.tags.some((x) => slug(x) === t)))
        return false;
      return words.length === 0 || textScore(m, words) > 0;
    })
    .map((m) => ({ m, score: rank(m, words, now) }))
    .sort((a, b) => b.score - a.score || a.m.title.localeCompare(b.m.title))
    .slice(0, filter.limit)
    .map(({ m }) => m);
}
