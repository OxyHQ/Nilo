/**
 * What Nilo keeps for the notes capability catalog Alia and MCP clients call
 * (`capabilities/`): receipts that make a retried write apply once, and the
 * events it owes Alia.
 */
import type { NormalizedAppEvent } from '@oxy.so/contracts';
import { createdAt, generatedId, timestamptz } from '@oxy.so/db';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * One receipt per effectful tool call: the account, the tool and the caller's
 * idempotency key. A retry after a lost answer gets the first result back
 * instead of a second write; the same key with other input is refused. The
 * receipt commits with the write it records.
 */
export const capabilityExecutions = pgTable(
  'capability_executions',
  {
    id: generatedId(),
    accountId: text().notNull(),
    tool: text().notNull(),
    idempotencyKey: text().notNull(),
    requestDigest: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('capability_executions_account_tool_key').on(t.accountId, t.tool, t.idempotencyKey),
    index('capability_executions_created_at_idx').on(t.createdAt),
  ],
);

/**
 * Events for Alia, written in the transaction of the change they describe and
 * delivered at least once by `capabilities/event-outbox.ts`: a row is claimed
 * for a lease, acknowledged once Alia took it, and set aside (`failedAt`)
 * after too many attempts.
 */
export const appEventOutbox = pgTable(
  'app_event_outbox',
  {
    id: generatedId(),
    eventId: text().notNull(),
    event: jsonb().$type<NormalizedAppEvent>().notNull(),
    processedAt: timestamptz(),
    claimedAt: timestamptz(),
    claimedBy: text(),
    attempts: integer().notNull().default(0),
    failedAt: timestamptz(),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('app_event_outbox_event_id_key').on(t.eventId),
    check('app_event_outbox_attempts_check', sql`${t.attempts} >= 0`),
    index('app_event_outbox_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null and ${t.failedAt} is null`),
  ],
);
