import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
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
    /** When a `schedule` automation is next due; null for the others and while it is off. */
    nextRunAt: timestamptz(),
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
    // The schedule sweep: what is due, soonest first.
    index('database_automations_due_idx')
      .on(t.nextRunAt)
      .where(sql`${t.enabled} and ${t.nextRunAt} is not null`),
    check(
      'database_automations_last_status',
      sql`${t.lastStatus} is null or ${t.lastStatus} in ('ok', 'failed')`,
    ),
  ],
);

/**
 * A webhook the receiver did not take yet, waiting for its next try
 * (`lib/webhook-retries.ts`). `attempt` counts the tries made through the queue.
 */
export const automationWebhookRetries = pgTable(
  'automation_webhook_retries',
  {
    id: generatedId(),
    automationId: text()
      .notNull()
      .references(() => databaseAutomations.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    body: text().notNull(),
    deliveryId: text().notNull(),
    attempt: integer().notNull().default(0),
    nextAttemptAt: timestamptz().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('automation_webhook_retries_due_idx').on(t.nextAttemptAt),
    index('automation_webhook_retries_automation_idx').on(t.automationId),
  ],
);
