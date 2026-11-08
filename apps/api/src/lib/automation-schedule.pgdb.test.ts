import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
  testDatabaseUrl,
} from '../db/__tests__/testDatabase.js';
import { closeDb } from '../db/client.js';
import { databaseAutomations } from '../db/schema/automations.js';
import { pages } from '../db/schema/pages.js';
import { workspaceMembers } from '../db/schema/workspaces.js';
import { runDueAutomations } from './automation-schedule.js';
import { createDatabaseWithRows } from './databases/create.js';
import { buildDefaultSchema } from './databases/schema-defaults.js';

const sent = vi.hoisted(() => ({ notifications: [] as Array<Record<string, unknown>> }));
vi.mock('./notification-service.js', () => ({
  sendNotification: async (n: Record<string, unknown>) => {
    sent.notifications.push(n);
  },
}));

let db: TestDatabase;
let workspaceId: string;
const me = 'schedule-me';
let previousUrl: string | undefined;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'automation-schedule');
  await db.insert(workspaceMembers).values({ workspaceId, userId: me, role: 'owner' });
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

const HOUR = 60 * 60 * 1000;

async function seed(overrides: Partial<typeof databaseAutomations.$inferInsert> = {}) {
  const { database } = await createDatabaseWithRows(db, {
    workspaceId,
    name: 'Standup',
    ownerId: me,
    schema: buildDefaultSchema(),
    isInline: false,
    parentPageId: null,
    teamspaceId: null,
    rows: [],
  });
  const [automation] = await db
    .insert(databaseAutomations)
    .values({
      databaseId: database.id,
      name: 'Every morning',
      trigger: { kind: 'schedule', every: 'day', hour: 9 },
      actions: [{ kind: 'create_row', title: 'Daily standup' }],
      createdBy: me,
      secret: 'secret',
      nextRunAt: new Date(Date.now() - HOUR),
      ...overrides,
    })
    .returning();
  const rowTitles = async () =>
    (await db.select().from(pages).where(eq(pages.databaseId, database.id))).map((p) => p.title);
  const current = async () =>
    (
      await db
        .select()
        .from(databaseAutomations)
        .where(eq(databaseAutomations.id, automation?.id as string))
    )[0];
  return { database, automation: automation as NonNullable<typeof automation>, rowTitles, current };
}

describe('the schedule sweep', () => {
  it('runs what is due once, and moves it to its next occurrence', async () => {
    const { automation, rowTitles, current } = await seed();
    const now = new Date();
    expect(await runDueAutomations(db, now)).toBeGreaterThanOrEqual(1);
    await vi.waitFor(async () => expect(await rowTitles()).toEqual(['Daily standup']));
    const after = await current();
    expect(after?.lastStatus).toBe('ok');
    expect(after?.nextRunAt && after.nextRunAt.getTime() > now.getTime()).toBe(true);
    expect(after?.nextRunAt && after.nextRunAt.getUTCHours()).toBe(9);

    // Not due again until then.
    await runDueAutomations(db, now);
    expect(await rowTitles()).toHaveLength(1);
    expect(automation.id).toBe(after?.id);
  });

  it('does not run one that is off, not yet due, or has no schedule', async () => {
    const off = await seed({ enabled: false });
    const later = await seed({ nextRunAt: new Date(Date.now() + HOUR) });
    const none = await seed({ nextRunAt: null });
    await runDueAutomations(db, new Date());
    expect(await off.rowTitles()).toEqual([]);
    expect(await later.rowTitles()).toEqual([]);
    expect(await none.rowTitles()).toEqual([]);
  });

  it('turns itself off when its creator can no longer edit the database', async () => {
    const { current, rowTitles } = await seed({ createdBy: 'stranger-without-access' });
    await runDueAutomations(db, new Date());
    await vi.waitFor(async () => expect((await current())?.enabled).toBe(false));
    expect((await current())?.lastStatus).toBe('failed');
    expect(await rowTitles()).toEqual([]);
  });

  it('tells the people it names, with no page', async () => {
    const { automation } = await seed({
      actions: [{ kind: 'notify', to: { kind: 'people', userIds: [me] }, message: 'Standup time' }],
    });
    await runDueAutomations(db, new Date());
    await vi.waitFor(() => {
      const mine = sent.notifications.filter(
        (n) => (n.data as { automationId?: string }).automationId === automation.id,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]?.body).toBe('Standup time');
      expect((mine[0]?.data as { pageId?: string }).pageId).toBeUndefined();
    });
  });
});
