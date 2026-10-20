import { sql } from 'drizzle-orm';
import { bigserial, check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, inList, timestamptz } from '@oxy.so/db';

/**
 * Nilo's side of Oxy's record of who uses a file (Oxy ADR 0043,
 * `docs/files.md`). Conventions come from `workspaces.ts`.
 *
 * `page_files` (in `pages.ts`) is the use itself; these tables are the
 * bookkeeping that keeps Oxy's references equal to it.
 */

/**
 * Oxy references Nilo still has to remove: one row per `page_files` row
 * deleted, written by the `page_files_release_reference` trigger in the
 * statement that deleted it (`db/triggers.ts`), so no path that deletes an
 * attachment — a reset, a cascade, the orphan sweep — can forget to. Drained
 * by `lib/file-references.ts` with Nilo's service token; a row leaves only
 * once Oxy has answered for it.
 */
export const fileReferenceRemovals = pgTable(
  'file_reference_removals',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    fileId: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    /** Attempts started, including one in flight; after each failure the next waits longer. */
    attempts: integer().notNull().default(0),
    /**
     * Not tried before this, once an attempt has been: a failed attempt's
     * backoff, or the lease of the drain that claimed it. Not read while
     * `attempts` is 0: a removal never tried is due at once
     * (`repositories/fileReferences.ts`).
     */
    nextAttemptAt: timestamptz().notNull().defaultNow(),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [index('file_reference_removals_due_idx').on(t.nextAttemptAt)],
);

/**
 * The file events Nilo has applied, by Oxy's event id: delivery is at least
 * once, so a redelivered event is recognised and acknowledged without being
 * applied again. Oxy stops redelivering 30 days after an event; rows older
 * than that are pruned by the nightly run.
 */
export const oxyFileEvents = pgTable(
  'oxy_file_events',
  {
    eventId: text().primaryKey(),
    type: text().notNull(),
    fileId: text().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [index('oxy_file_events_received_idx').on(t.receivedAt)],
);

/**
 * What Oxy last told Nilo about a file (`oxy_file_statuses.status`, from its
 * file events). Only `active` is served by Oxy; the others are shown as
 * removed rather than as a file still loading.
 */
export const OXY_FILE_STATUSES = ['active', 'trash', 'deleted', 'blocked'] as const;
export type OxyFileStatus = (typeof OXY_FILE_STATUSES)[number];

/**
 * The last status Oxy reported for a file Nilo uses — an upload or a file a
 * page's properties list (Noted's attachments) alike — and when that change
 * happened in Oxy, so an older event never overwrites a newer one. A file
 * with no row is taken to be `active`.
 */
export const oxyFileStatuses = pgTable(
  'oxy_file_statuses',
  {
    fileId: text().primaryKey(),
    status: text().$type<OxyFileStatus>().notNull(),
    statusAt: timestamptz().notNull(),
  },
  (t) => [
    check('oxy_file_statuses_status', sql`${t.status} in (${sql.raw(inList(OXY_FILE_STATUSES))})`),
  ],
);

/** The scheduled file jobs, one row each (`file_reference_runs.job`). */
export const FILE_REFERENCE_JOBS = ['nightly'] as const;
export type FileReferenceJob = (typeof FILE_REFERENCE_JOBS)[number];

/**
 * When each scheduled file job last ran and what it found. Every API task
 * ticks; the one that takes the lease runs the job, so it runs once a day
 * however many tasks there are. `report` is what it found and changed.
 */
export const fileReferenceRuns = pgTable(
  'file_reference_runs',
  {
    job: text().$type<FileReferenceJob>().primaryKey(),
    leasedUntil: timestamptz(),
    startedAt: timestamptz(),
    finishedAt: timestamptz(),
    report: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    check('file_reference_runs_job', sql`${t.job} in (${sql.raw(inList(FILE_REFERENCE_JOBS))})`),
  ],
);
