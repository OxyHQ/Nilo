/**
 * Running a database's automations. `rowWritten` hands every committed row
 * write here: each enabled automation of the row's database whose trigger the
 * write fires runs its actions in order, as the person who made it and with
 * their access (an automation whose creator can no longer edit the database
 * is switched off, not run). A failed action stops that automation and is
 * recorded on it; it never fails the write that fired it. What an action
 * writes is itself a row write, so automations can start each other, to
 * `MAX_AUTOMATION_DEPTH` and no further.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { SsrfRejection, safeFetch } from '@oxy.so/core/server';
import {
  type Automation,
  type AutomationAction,
  type AutomationTrigger,
  isSafeUrl,
  MAX_AUTOMATION_DEPTH,
  triggerFires,
} from '@oxy.so/nilo-contracts';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { databaseAutomations } from '../../db/schema/automations.js';
import type { PageProperties } from '../../db/schema/pages.js';
import { hasRole } from '../../db/schema/workspaces.js';
import { findDatabaseById } from '../../repositories/databases.js';
import { findPageById, type PageRow } from '../../repositories/pages.js';
import { log } from '../logger.js';
import { sendNotification } from '../notification-service.js';
import { resolveDatabaseRole, resolvePageAccess } from '../page-access.js';
import { insertRow, parseRowProperties, rowWritten, writePage } from './row-writes.js';

type AutomationRow = typeof databaseAutomations.$inferSelect;

interface RowEvent {
  database: { id: string; workspaceId: string };
  row: PageRow;
  before: PageProperties;
  /** The row was just added. */
  created: boolean;
  /** How many automations deep this write is (0: a person's). */
  depth: number;
}

/** The automation as the API serves it: never its secret. */
export function serializeAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    databaseId: row.databaseId,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    actions: row.actions,
    createdBy: row.createdBy,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastStatus: row.lastStatus as Automation['lastStatus'],
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A webhook's signature header: `t=<unix seconds>,v1=<hex hmac-sha256 of "t.body">`. */
export function signWebhook(secret: string, body: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** Run what `event` triggers; resolves when every automation has run. Never throws. */
export async function runAutomations(event: RowEvent): Promise<void> {
  try {
    if (event.row.template) return;
    const db = getDb();
    const automations = await db
      .select()
      .from(databaseAutomations)
      .where(
        and(
          eq(databaseAutomations.databaseId, event.database.id),
          eq(databaseAutomations.enabled, true),
        ),
      );
    const fired = automations.filter((a) =>
      triggerFires(a.trigger as AutomationTrigger, {
        created: event.created,
        before: event.before,
        after: event.row.properties,
      }),
    );
    if (fired.length === 0) return;
    if (event.depth >= MAX_AUTOMATION_DEPTH) {
      log.general.warn(
        { databaseId: event.database.id, rowId: event.row.id },
        'Automations stopped: they trigger each other too deep',
      );
      return;
    }
    for (const automation of fired) await runOne(automation, event);
  } catch (err: unknown) {
    log.general.error({ err }, 'Running automations failed');
  }
}

async function runOne(automation: AutomationRow, event: RowEvent): Promise<void> {
  const db = getDb();
  const record = async (status: 'ok' | 'failed', error: string | null, enabled?: boolean) => {
    await db
      .update(databaseAutomations)
      .set({
        lastRunAt: new Date(),
        lastStatus: status,
        lastError: error,
        ...(enabled !== undefined && { enabled }),
      })
      .where(eq(databaseAutomations.id, automation.id));
  };
  try {
    const database = await findDatabaseById(db, event.database.id);
    const role = database ? await resolveDatabaseRole(db, automation.createdBy, database) : null;
    if (!database || !role || !hasRole(role, 'editor')) {
      await record('failed', 'Its creator can no longer edit the database', false);
      return;
    }
    for (const action of automation.actions) {
      await runAction(action, automation, event);
    }
    await record('ok', null);
  } catch (err: unknown) {
    const message =
      err instanceof SsrfRejection
        ? 'The webhook is not a public web address'
        : String(err instanceof Error ? err.message : err);
    log.general.warn({ err, automationId: automation.id }, 'An automation failed');
    await record('failed', message.slice(0, 500)).catch(() => undefined);
  }
}

async function runAction(
  action: AutomationAction,
  automation: AutomationRow,
  event: RowEvent,
): Promise<void> {
  const db = getDb();
  switch (action.kind) {
    case 'set_property': {
      const database = await findDatabaseById(db, event.database.id);
      const page = await findPageById(db, event.row.id);
      if (!database || !page || page.archived) return;
      if (page.locked) throw new Error('The page is locked');
      const parsed = parseRowProperties(database.propertiesSchema, {
        [action.propertyId]: action.value,
      });
      if ('refusal' in parsed) throw new Error(parsed.refusal.error);
      const updated = await writePage(
        db,
        page,
        {
          mergeProperties: parsed.merge,
          ...(parsed.name !== null && { title: parsed.name }),
          lastEditedBy: automation.createdBy,
        },
        { rowDatabase: database, movesTrash: false },
      );
      if (updated) {
        rowWritten({
          database,
          row: updated,
          before: page.properties,
          actorId: automation.createdBy,
          propertiesChanged: true,
          automationDepth: event.depth + 1,
        });
      }
      return;
    }
    case 'notify': {
      const ids =
        action.to.kind === 'people'
          ? action.to.userIds
          : peopleIn(event.row.properties[action.to.propertyId]);
      for (const userId of new Set(ids)) {
        // Only people who can open the row hear about it.
        if (!(await resolvePageAccess(db, userId, event.row.id))) continue;
        await sendNotification({
          userId,
          type: 'automation',
          title: event.row.title || 'Untitled',
          body: action.message || automation.name,
          priority: 'normal',
          data: {
            pageId: event.row.id,
            databaseId: event.database.id,
            automationId: automation.id,
            workspaceId: event.row.workspaceId,
          },
        });
      }
      return;
    }
    case 'webhook': {
      if (!isSafeUrl(action.url)) throw new Error('The webhook is not a web address');
      const now = new Date();
      const body = JSON.stringify({
        event: 'automation.triggered',
        automationId: automation.id,
        databaseId: event.database.id,
        trigger: (automation.trigger as AutomationTrigger).kind,
        row: {
          id: event.row.id,
          title: event.row.title,
          properties: event.row.properties,
        },
        at: now.toISOString(),
      });
      const sent = await safeFetch(action.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'NiloBot/1.0 (+https://nilo.so/bot)',
          'x-nilo-delivery': randomUUID(),
          'x-nilo-signature': signWebhook(automation.secret, body, now),
        },
        body,
        redirect: 'manual',
        headersTimeoutMs: 8000,
      });
      sent.response.destroy();
      if (sent.status < 200 || sent.status >= 300) {
        throw new Error(`The webhook answered ${sent.status}`);
      }
      return;
    }
    case 'create_row': {
      const target = await findDatabaseById(db, action.databaseId ?? event.database.id);
      if (!target || target.workspaceId !== event.database.workspaceId) {
        throw new Error('The database to add a page to is gone');
      }
      const role = await resolveDatabaseRole(db, automation.createdBy, target);
      if (!role || !hasRole(role, 'editor')) {
        throw new Error('Its creator cannot edit the database to add a page to');
      }
      const row = await insertRow(db, target, {
        ownerId: automation.createdBy,
        title: action.title ?? '',
        properties: {},
      });
      rowWritten({
        database: target,
        row,
        before: {},
        actorId: automation.createdBy,
        propertiesChanged: true,
        created: true,
        automationDepth: event.depth + 1,
      });
      return;
    }
  }
}

function peopleIn(value: unknown): string[] {
  const ids = (value as { userIds?: unknown } | null | undefined)?.userIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
