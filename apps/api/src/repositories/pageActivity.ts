import { isDeepStrictEqual } from 'node:util';
import type {
  PageActivityChange,
  PageActivityKind,
  PageActivityPage,
} from '@oxy.so/nilo-contracts';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pageActivity } from '../db/schema/page-activity.js';
import { databases } from '../db/schema/databases.js';

export async function recordPageActivity(
  db: PgHandle,
  input: {
    pageId: string;
    actorIds: string[];
    kind: PageActivityKind;
    changes?: PageActivityChange[];
  },
): Promise<void> {
  await db.insert(pageActivity).values({
    ...input,
    actorIds: [...new Set(input.actorIds.filter(Boolean))],
    changes: input.changes ?? [],
  });
}

const fields = [
  'title',
  'icon',
  'cover',
  'coverPosition',
  'parentId',
  'teamspaceId',
  'archived',
  'template',
  'fullWidth',
  'smallText',
  'font',
  'mode',
  'locked',
] as const;

/** Compare the actual locked rows, not a caller's possibly stale read. */
export async function recordPageChanges(
  db: PgHandle,
  before: Record<string, unknown> & { id: string; properties: Record<string, unknown> },
  after: typeof before,
  actorId?: string,
): Promise<void> {
  const changes = fields.flatMap((field): PageActivityChange[] =>
    isDeepStrictEqual(before[field], after[field])
      ? []
      : [{ field, before: before[field], after: after[field] }],
  );
  const properties = [
    ...new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]),
  ].flatMap((propertyId): PageActivityChange[] =>
    isDeepStrictEqual(before.properties[propertyId], after.properties[propertyId])
      ? []
      : [
          {
            field: 'properties',
            propertyId,
            before: before.properties[propertyId] ?? null,
            after: after.properties[propertyId] ?? null,
          },
        ],
  );
  if (properties.length && typeof after.databaseId === 'string') {
    const [database] = await db
      .select({ schema: databases.propertiesSchema })
      .from(databases)
      .where(eq(databases.id, after.databaseId));
    const schema = new Map(
      database?.schema.properties.map((property) => [property.id, property]) ?? [],
    );
    for (const change of properties) {
      const property = schema.get(change.propertyId ?? '');
      if (!property) continue;
      const { options, format, precision, dateFormat, includeTime, prefix } = property.config ?? {};
      change.property = {
        name: property.name,
        type: property.type,
        config: {
          options: options?.map(({ id, name, color }) => ({ id, name, color })),
          format,
          precision,
          dateFormat,
          includeTime,
          prefix,
        },
      };
    }
  }
  const actorIds = actorId ? [actorId] : [];
  if (changes.length)
    await recordPageActivity(db, { pageId: after.id, actorIds, kind: 'metadata_changed', changes });
  if (properties.length)
    await recordPageActivity(db, {
      pageId: after.id,
      actorIds,
      kind: 'properties_changed',
      changes: properties,
    });
}

export interface ActivityCursor {
  pageId: string;
  createdAt: string;
  id: string;
}

export async function listPageActivity(
  db: PgHandle,
  pageId: string,
  limit: number,
  cursor?: ActivityCursor,
): Promise<PageActivityPage> {
  const rows = await db
    .select()
    .from(pageActivity)
    .where(
      and(
        eq(pageActivity.pageId, pageId),
        cursor
          ? or(
              lt(pageActivity.createdAt, new Date(cursor.createdAt)),
              and(
                eq(pageActivity.createdAt, new Date(cursor.createdAt)),
                lt(pageActivity.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(pageActivity.createdAt), desc(pageActivity.id))
    .limit(limit + 1);
  const items = rows
    .slice(0, limit)
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ pageId, createdAt: last.createdAt, id: last.id })).toString(
            'base64url',
          )
        : null,
  };
}
