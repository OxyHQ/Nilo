import { createdAt, generatedId } from '@oxy.so/db';
import type { PageActivityChange, PageActivityKind } from '@oxy.so/nilo-contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { pages } from './pages.js';

/** Historical values require editor access to the page; no synthetic backfill. */
export const pageActivity = pgTable(
  'page_activity',
  {
    id: generatedId(),
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    actorIds: jsonb().$type<string[]>().notNull(),
    kind: text().$type<PageActivityKind>().notNull(),
    changes: jsonb().$type<PageActivityChange[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('page_activity_page_created_idx').on(t.pageId, t.createdAt, t.id),
    check(
      'page_activity_kind',
      sql`${t.kind} in ('created', 'metadata_changed', 'properties_changed', 'content_edited')`,
    ),
  ],
);
