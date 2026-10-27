import { createdAt, inList, timestamptz, updatedAt } from '@oxy.so/db';
import {
  CALENDAR_SUBSCRIPTION_ERRORS,
  CALENDAR_SUBSCRIPTION_STATUSES,
  type CalendarSubscriptionError,
  type CalendarSubscriptionStatus,
} from '@oxy.so/nilo-contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { databases } from './databases.js';
import { workspaces } from './workspaces.js';

/**
 * A calendar kept in step with an outside iCalendar feed (Google's secret
 * address, Outlook's published calendar, an iCloud public calendar, any
 * CalDAV server's ICS link): `docs/calendar.md`, `lib/calendar/subscriptions.ts`.
 *
 * The calendar is a database of its own (`databases.read_only`), one per
 * subscription, so the subscription's id IS the calendar's: `database_id` is
 * the key, and deleting the database deletes the subscription.
 *
 * The feed's URL is a secret (whoever holds it reads the calendar): it is
 * stored only sealed with `CALENDAR_FEED_KEY` (`lib/calendar/feed-secret.ts`),
 * never logged and never answered. `url_fingerprint` (a keyed hash of it)
 * finds a second subscription to the same feed; `url_host` is what the API
 * shows of it.
 */
export const calendarSubscriptions = pgTable(
  'calendar_subscriptions',
  {
    databaseId: text()
      .primaryKey()
      .references(() => databases.id, { onDelete: 'cascade' }),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The Oxy user who subscribed: the only one who manages it, and the rows' owner. */
    ownerId: text().notNull(),
    /** The URL, sealed (`v1.<iv>.<tag>.<ciphertext>`, base64url). */
    urlSealed: text().notNull(),
    /** HMAC of the URL under a key derived from `CALENDAR_FEED_KEY`. */
    urlFingerprint: text().notNull(),
    urlHost: text().notNull(),
    /** The zone of the feed's floating times (with neither `Z` nor a known `TZID`). */
    timeZone: text().notNull().default('UTC'),
    status: text().$type<CalendarSubscriptionStatus>().notNull().default('pending'),
    lastError: text().$type<CalendarSubscriptionError>(),
    /** The HTTP status of the last answer that was not a success. */
    lastHttpStatus: integer(),
    consecutiveFailures: integer().notNull().default(0),
    /** The feed's validators, sent back as `If-None-Match` / `If-Modified-Since`. */
    etag: text(),
    lastModified: text(),
    /** SHA-256 of the last document applied: an unchanged body is not applied again. */
    contentHash: text(),
    eventCount: integer().notNull().default(0),
    /** Repeating events whose rule Nilo does not support, kept as their first occurrence. */
    simplifiedCount: integer().notNull().default(0),
    lastAttemptAt: timestamptz(),
    lastSuccessAt: timestamptz(),
    lastChangeAt: timestamptz(),
    nextRefreshAt: timestamptz().notNull().defaultNow(),
    /** Held while one task refreshes it, so no other task or request does at once. */
    refreshingUntil: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('calendar_subscriptions_due_idx').on(t.nextRefreshAt),
    index('calendar_subscriptions_owner_idx').on(t.ownerId, t.createdAt),
    uniqueIndex('calendar_subscriptions_owner_url').on(t.ownerId, t.urlFingerprint),
    check(
      'calendar_subscriptions_status',
      sql`${t.status} in (${sql.raw(inList(CALENDAR_SUBSCRIPTION_STATUSES))})`,
    ),
    check(
      'calendar_subscriptions_last_error',
      sql`${t.lastError} is null or ${t.lastError} in (${sql.raw(inList(CALENDAR_SUBSCRIPTION_ERRORS))})`,
    ),
  ],
);

export type CalendarSubscriptionRow = typeof calendarSubscriptions.$inferSelect;
