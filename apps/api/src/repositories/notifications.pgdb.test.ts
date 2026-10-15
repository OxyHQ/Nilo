import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, type TestDatabase } from '../db/__tests__/testDatabase.js';
import { notifications } from '../db/schema/collab.js';
import { createNotification, recentlyNotified } from './notifications.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

const notice = (oxyUserId: string, pageId: string, status: 'sent' | 'read' = 'sent') =>
  createNotification(db as never, {
    oxyUserId,
    type: 'page_edited',
    title: 'Edited',
    body: '',
    channels: ['in_app'],
    deliveryStatus: { in_app: 'sent' },
    status,
    priority: 'low',
    data: { pageId },
  });

describe('recentlyNotified', () => {
  it('names those with an unread, recent notice about the page', async () => {
    const pageId = `p-${Date.now()}`;
    await notice('rn-unread', pageId);
    await notice('rn-read', pageId, 'read');
    await notice('rn-other-page', `${pageId}-x`);
    const old = await notice('rn-old', pageId);
    await db
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where((await import('drizzle-orm')).eq(notifications.id, old.id));

    const told = await recentlyNotified(db as never, {
      type: 'page_edited',
      pageId,
      userIds: ['rn-unread', 'rn-read', 'rn-other-page', 'rn-old', 'rn-none'],
      within: '1 hour',
    });
    expect(told).toEqual(['rn-unread']);
  });
});
