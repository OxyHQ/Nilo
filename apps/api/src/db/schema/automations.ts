import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, timestamptz, updatedAt } from '@oxy.so/db';
import type { AutomationAction, AutomationTrigger } from '@oxy.so/nilo-contracts';
import { databases } from './databases.js';

/**
 * A database's automations: when its rows change in a way `trigger` names, run
 * `actions`. The executor (`lib/databases/automations.ts`) runs them after the
 * row's write has committed, as `createdBy`, and stops running an automation
 * whose creator can no longer edit the database.
 */
export const databaseAutomations = pgTable(
  'database_automations',
  {
    id: generatedId(),
    databaseId: text()
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    enabled: boolean().notNull().default(true),
    trigger: jsonb().$type<AutomationTrigger>().notNull(),
    actions: jsonb().$type<AutomationAction[]>().notNull(),
    /** Oxy user id of whoever made it: the actions run with their access. */
    createdBy: text().notNull(),
    /** Signs the automation's webhooks (`x-nilo-signature`); the receiver's to verify with. */
    secret: text().notNull(),
    lastRunAt: timestamptz(),
    /** `ok` or `failed`; null before the first run. */
    lastStatus: text(),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The executor: the enabled automations of the database a row was written to.
    index('database_automations_database_idx').on(t.databaseId).where(sql`${t.enabled}`),
    check(
      'database_automations_last_status',
      sql`${t.lastStatus} is null or ${t.lastStatus} in ('ok', 'failed')`,
    ),
  ],
);
