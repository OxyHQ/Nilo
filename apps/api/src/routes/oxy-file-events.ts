/**
 * `POST /webhooks/oxy/files` — Oxy's file events (Oxy ADR 0043 D9,
 * `docs/files.md`): a file Nilo uses was deleted, moved to trash, restored,
 * taken down or put back, or changed visibility.
 *
 * Mounted before `express.json()` (`index.ts`): the signature covers the
 * exact bytes Oxy sent, so the body is read raw and parsed only by
 * `verifyFileEventSignature`. The endpoint's verification challenge is echoed
 * without a secret — Oxy shows the secret only once the endpoint has answered
 * it — and every other request needs `OXY_FILES_WEBHOOK_SECRET`.
 *
 * Each event carries the file's status after the change; Nilo records it
 * (`oxy_file_statuses`), so a reader is told the file was removed instead of
 * waiting for a URL Oxy will never mint, the app stops showing its own copy,
 * and a note lists it among its removed attachments. Delivery is at least
 * once and in no promised order: the event id is remembered and an older
 * event never overwrites a newer one.
 */
import { FileEventVerificationError, verifyFileEventSignature } from '@oxy.so/core/server';
import express, { type Request, type Response } from 'express';
import { getDb } from '../db/client.js';
import { OXY_FILE_STATUSES, type OxyFileStatus } from '../db/schema/files.js';
import { log } from '../lib/logger.js';
import { applyOxyFileEvent } from '../repositories/fileReferences.js';

export const OXY_FILE_EVENTS_PATH = '/webhooks/oxy/files';

/** Comfortably above any file event; Oxy's are a few hundred bytes. */
export const rawFileEventBody = express.raw({ type: '*/*', limit: '64kb' });

const isStatus = (value: unknown): value is OxyFileStatus =>
  (OXY_FILE_STATUSES as readonly unknown[]).includes(value);

export async function oxyFileEventsHandler(req: Request, res: Response): Promise<void> {
  const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const secret = process.env.OXY_FILES_WEBHOOK_SECRET ?? '';
  let event: ReturnType<typeof verifyFileEventSignature>;
  try {
    event = verifyFileEventSignature(body, req.headers, secret);
  } catch (err: unknown) {
    if (!secret && err instanceof FileEventVerificationError) {
      // Not configured yet: a non-2xx answer keeps the event in Oxy's retries.
      log.general.error('A file event arrived but OXY_FILES_WEBHOOK_SECRET is not set');
      res.status(503).json({ error: 'File events are not configured' });
      return;
    }
    res.status(401).json({ error: 'Invalid file event' });
    return;
  }

  if (event.type === 'webhook.challenge') {
    res.json({ challenge: event.challenge });
    return;
  }

  try {
    const status = isStatus(event.file.status) ? event.file.status : null;
    if (!status) {
      log.general.warn(
        { eventId: event.id, type: event.type, status: event.file.status },
        'File event with a status Nilo does not know; recorded, not applied',
      );
    }
    const occurred = new Date(event.occurredAt);
    await applyOxyFileEvent(getDb(), {
      id: event.id,
      type: event.type,
      fileId: event.file.id,
      status,
      at: Number.isNaN(occurred.getTime()) ? new Date() : occurred,
    });
    res.status(204).end();
  } catch (err: unknown) {
    log.general.error({ err, eventId: event.id }, 'Failed to apply a file event');
    res.status(500).json({ error: 'Failed to apply the event' });
  }
}
