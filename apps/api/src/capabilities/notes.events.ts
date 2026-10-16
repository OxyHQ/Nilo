/**
 * The events the notes catalog declares (`notes.catalog.ts` `events`), queued
 * in the transaction of the change they describe; `event-outbox.ts` delivers
 * them to Alia.
 */
import { createHash } from 'node:crypto';
import { type NormalizedAppEvent, normalizedAppEventSchema } from '@oxy.so/contracts';
import type { PgHandle } from '../db/client.js';
import { appEventOutbox } from '../db/schema/capabilities.js';
import { NOTES_CAPABILITY_CATALOG } from './notes.catalog.js';

const APP_ID = NOTES_CAPABILITY_CATALOG.appId;

function eventId(parts: readonly string[]): string {
  return `${APP_ID}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

async function enqueue(db: PgHandle, event: NormalizedAppEvent): Promise<void> {
  const parsed = normalizedAppEventSchema.parse(event);
  await db
    .insert(appEventOutbox)
    .values({ eventId: parsed.eventId, event: parsed })
    .onConflictDoNothing({ target: appEventOutbox.eventId });
}

export type NoteChange = 'created' | 'updated' | 'archived' | 'trashed' | 'restored' | 'deleted';

function noteResource(accountId: string, noteId: string) {
  return {
    appId: APP_ID,
    effectiveAccountId: accountId,
    resourceType: 'note',
    resourceId: noteId,
  };
}

/** `key` makes the event one of its own: the tool call's idempotency key, or a fresh id. */
export function buildNoteChangedEvent(input: {
  accountId: string;
  noteId: string;
  change: NoteChange;
  key: string;
  occurredAt: string;
}): NormalizedAppEvent {
  return normalizedAppEventSchema.parse({
    eventId: eventId([input.accountId, input.noteId, input.change, input.key]),
    appId: APP_ID,
    accountId: input.accountId,
    resource: noteResource(input.accountId, input.noteId),
    type: 'note_changed',
    occurredAt: input.occurredAt,
    data: { noteId: input.noteId, change: input.change },
  });
}

export function enqueueNoteChanged(
  db: PgHandle,
  input: Parameters<typeof buildNoteChangedEvent>[0],
): Promise<void> {
  return enqueue(db, buildNoteChangedEvent(input));
}

export function buildReminderEvent(input: {
  accountId: string;
  noteId: string;
  reminderAt: Date;
}): NormalizedAppEvent {
  const reminderAt = input.reminderAt.toISOString();
  return normalizedAppEventSchema.parse({
    eventId: eventId([input.accountId, input.noteId, 'reminder', reminderAt]),
    appId: APP_ID,
    accountId: input.accountId,
    resource: noteResource(input.accountId, input.noteId),
    type: 'reminder',
    occurredAt: reminderAt,
    data: { noteId: input.noteId, reminderAt },
  });
}

export function enqueueReminder(
  db: PgHandle,
  input: Parameters<typeof buildReminderEvent>[0],
): Promise<void> {
  return enqueue(db, buildReminderEvent(input));
}
