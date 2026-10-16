/**
 * A page's `blocks` rows, read from its document (`page-docs.ts`).
 *
 * The document is the truth; the rows are what everything that does not edit
 * reads: search, exports, share links, published pages, backlinks, file
 * access. After changes arrive, a page is projected again shortly (once the
 * burst settles), and right away when a reader needs it now (an export, a
 * copy). Projecting also does what an edit means for a page: history (the
 * page as it was before the first change after a quiet spell), who edited it
 * last, following it, telling people newly mentioned and the page's
 * followers.
 *
 * The document is read inside the page's row lock, so two projections can
 * never commit an older state over a newer one.
 */
import { materialize } from '@oxy.so/bloom-editor/yjs';
import {
  type BlockContent,
  type BlockType,
  isBlockType,
  normalizeContent,
} from '@oxy.so/nilo-contracts';
import { documentToRows } from '@oxy.so/nilo-contracts/editor';
import type { z } from 'zod';
import * as Y from 'yjs';
import type { segmentSchema } from '@oxy.so/nilo-contracts';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import { isSystemDatabase } from './databases/system.js';
import {
  type BlockRow,
  createBlock,
  deleteBlocksOfPage,
  findBlocksByIds,
  listBlocksForPage,
  updateBlock,
} from '../repositories/blocks.js';
import { recentlyNotified } from '../repositories/notifications.js';
import { follow, listFollowers } from '../repositories/pageFollows.js';
import { bumpBlocksVersion, findPageById, lockPage } from '../repositories/pages.js';
import { snapshotPage } from '../repositories/pageVersions.js';
import { log } from './logger.js';
import { sendNotification } from './notification-service.js';
import { resolvePageAccess } from './page-access.js';
import { ensurePageDoc, readPageState, SERVER_ORIGIN } from './page-docs.js';

/** Someone mentioned in a page's text who was not mentioned anywhere in it before. */
export interface NewMention {
  userId: string;
  blockId: string;
  /** The block's text, for the notification. */
  text: string;
}

/** The people a page's blocks mention (`mention.attributes.kind === 'user'`), each with a block. */
function peopleMentioned(
  contents: Iterable<readonly [string, BlockContent]>,
): Map<string, { blockId: string; text: string }> {
  const people = new Map<string, { blockId: string; text: string }>();
  for (const [blockId, content] of contents) {
    const segments = (content.segments ?? []) as z.infer<typeof segmentSchema>[];
    for (const segment of segments) {
      const attributes = segment.mention?.attributes;
      if (attributes?.kind !== 'user' || !attributes.id || people.has(attributes.id)) continue;
      people.set(attributes.id, {
        blockId,
        text: typeof content.text === 'string' ? content.text : '',
      });
    }
  }
  return people;
}

interface TargetRow {
  id: string;
  parentBlockId: string | null;
  type: BlockType;
  content: BlockContent;
  order: number;
}

/**
 * The rows the document holds, as the API stores them. A block whose id
 * belongs to another page (only a forged update could do that) is left out
 * with everything under it, as is an unknown type's subtree.
 */
async function targetRows(db: PgHandle, pageId: string, doc: Y.Doc): Promise<TargetRow[]> {
  const rows = documentToRows(materialize(doc));
  const foreign = new Set(
    (
      await findBlocksByIds(
        db,
        rows.map((row) => row.id),
      )
    )
      .filter((row) => row.pageId !== pageId)
      .map((row) => row.id),
  );
  const skipped = new Set<string>();
  const out: TargetRow[] = [];
  // Parents come before their children (`documentToRows` reads depth first).
  for (const row of rows) {
    if (
      foreign.has(row.id) ||
      !isBlockType(row.type) ||
      (row.parentBlockId !== null && skipped.has(row.parentBlockId))
    ) {
      skipped.add(row.id);
      continue;
    }
    out.push({
      id: row.id,
      parentBlockId: row.parentBlockId,
      type: row.type,
      content: normalizeContent(row.type, row.content),
      order: row.order,
    });
  }
  return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function differs(existing: BlockRow, target: TargetRow): boolean {
  return (
    existing.parentBlockId !== target.parentBlockId ||
    existing.type !== target.type ||
    existing.order !== target.order ||
    !sameJson(existing.content, target.content)
  );
}

/**
 * Bring a page's rows to what its document holds. `actorIds`: who made the
 * changes being projected ('' for the server); the last one is recorded as
 * the page's last editor.
 */
export async function projectPage(
  db: PgHandle,
  pageId: string,
  actorIds: readonly string[] = [],
): Promise<void> {
  await ensurePageDoc(db, pageId);
  const people = actorIds.filter((id) => id !== '');
  let mentioned: NewMention[] = [];
  let changed = false;
  await db.transaction(async (tx) => {
    if (!(await lockPage(tx, pageId))) return;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await readPageState(tx, pageId)).state, SERVER_ORIGIN);
    const target = await targetRows(tx, pageId, doc);
    const existing = await listBlocksForPage(tx, pageId);
    const byId = new Map(existing.map((row) => [row.id, row]));
    const keep = new Set(target.map((row) => row.id));
    const removed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
    const writes = target.filter((row) => {
      const current = byId.get(row.id);
      return !current || differs(current, row);
    });
    if (writes.length === 0 && removed.length === 0) return;
    changed = true;

    // History first: the page as it was before this change.
    await snapshotPage(tx, { pageId, rows: existing, actorId: people[0] ?? '' });
    // Parents before children, moves before removals (a child moved out of a
    // removed block must not go with it).
    for (const row of writes) {
      if (byId.has(row.id)) {
        await updateBlock(tx, row.id, {
          parentBlockId: row.parentBlockId,
          type: row.type,
          content: row.content,
          order: row.order,
        });
      } else {
        await createBlock(tx, { ...row, pageId, contentVersion: 0 });
      }
    }
    await deleteBlocksOfPage(tx, pageId, removed);
    await bumpBlocksVersion(tx, pageId, people[people.length - 1]);
    // Whoever edits a page follows it (a no-op when they already do).
    for (const userId of new Set(people)) await follow(tx, pageId, userId);

    const before = peopleMentioned(existing.map((row) => [row.id, row.content]));
    mentioned = [...peopleMentioned(target.map((row) => [row.id, row.content]))]
      .filter(([userId]) => !before.has(userId))
      .map(([userId, at]) => ({ userId, ...at }));
  });
  if (!changed) return;
  const page = await findPageById(db, pageId);
  if (!page) return;
  // An app syncing a system database (Noted's notes) hears a body edit as a
  // row change.
  if (page.databaseId) {
    const { workspaceId, databaseId } = page;
    void isSystemDatabase(getDb(), databaseId)
      .then((system) => {
        if (system) announceChange({ workspaceId, databaseId });
      })
      .catch((err: unknown) => log.general.warn({ err }, 'Failed to announce a row edit'));
  }
  const author = people[people.length - 1];
  if (!author) return;
  void notifyMentioned(mentioned, page, author);
  void notifyFollowersOfEdit(page, author);
}

/** How long a page's changes settle before it is projected. */
const SETTLE_MS = 800;
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; actors: Set<string> }>();
const running = new Map<string, Promise<void>>();

function run(pageId: string, actors: readonly string[]): Promise<void> {
  const previous = running.get(pageId) ?? Promise.resolve();
  const next = previous
    .then(() => projectPage(getDb(), pageId, actors))
    .catch((err: unknown) => log.general.error({ err, pageId }, 'Page projection failed'))
    .finally(() => {
      if (running.get(pageId) === next) running.delete(pageId);
    });
  running.set(pageId, next);
  return next;
}

/** Project a page once its changes settle. */
export function scheduleProjection(pageId: string, actorId: string): void {
  const entry = pending.get(pageId);
  if (entry) {
    clearTimeout(entry.timer);
    entry.actors.add(actorId);
  }
  const actors = entry?.actors ?? new Set([actorId]);
  const timer = setTimeout(() => {
    pending.delete(pageId);
    void run(pageId, [...actors]);
  }, SETTLE_MS);
  timer.unref?.();
  pending.set(pageId, { timer, actors });
}

/** Project a page now, folding in a projection this process had waiting for it. */
export function projectNow(pageId: string, actorId?: string): Promise<void> {
  const entry = pending.get(pageId);
  const actors = new Set(entry?.actors ?? []);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(pageId);
  }
  if (actorId !== undefined) actors.add(actorId);
  return run(pageId, [...actors]);
}

/** For tests and shutdown: run every projection waiting in this process. */
export async function flushProjections(): Promise<void> {
  await Promise.all([...pending.keys()].map((pageId) => projectNow(pageId)));
  await Promise.all([...running.values()]);
}

/**
 * Tell the people newly mentioned in a page's text, as Notion does — those
 * who can open the page, never the writer. Best effort: the edit is saved.
 */
async function notifyMentioned(
  mentioned: readonly NewMention[],
  page: { id: string; title: string },
  authorId: string,
): Promise<void> {
  for (const { userId, blockId, text } of mentioned) {
    if (userId === authorId) continue;
    try {
      if (!(await resolvePageAccess(getDb(), userId, page.id))) continue;
      await sendNotification({
        userId,
        type: 'mention',
        title: `You were mentioned in ${page.title || 'Untitled'}`,
        body: text.slice(0, 280),
        priority: 'normal',
        data: { pageId: page.id, blockId, authorId },
      });
    } catch (err: unknown) {
      log.general.warn({ err, userId, pageId: page.id }, 'Failed to send mention notification');
    }
  }
}

/** How often one process looks at a page's followers while it is being edited. */
const EDIT_CHECK_MS = 60_000;
/** One unread "edited" notification per follower and page in this window. */
const EDIT_NOTICE_WINDOW = '1 hour';
const lastEditCheck = new Map<string, number>();

/**
 * Tell the people following a page that someone edited it, as Notion's
 * updates do — never the editor, only those who can still open it, in the app
 * only, and grouped: nothing more while an earlier one is unread and recent.
 */
async function notifyFollowersOfEdit(page: { id: string; title: string }, authorId: string) {
  const now = Date.now();
  if (now - (lastEditCheck.get(page.id) ?? 0) < EDIT_CHECK_MS) return;
  lastEditCheck.set(page.id, now);
  if (lastEditCheck.size > 10_000) lastEditCheck.clear();
  try {
    const db = getDb();
    const followers = (await listFollowers(db, page.id)).filter((id) => id !== authorId);
    if (followers.length === 0) return;
    const told = new Set(
      await recentlyNotified(db, {
        type: 'page_edited',
        pageId: page.id,
        userIds: followers,
        within: EDIT_NOTICE_WINDOW,
      }),
    );
    for (const userId of followers) {
      if (told.has(userId) || !(await resolvePageAccess(db, userId, page.id))) continue;
      await sendNotification({
        userId,
        type: 'page_edited',
        title: `${page.title || 'Untitled'} was edited`,
        body: '',
        priority: 'low',
        channels: ['in_app'],
        data: { pageId: page.id, authorId },
      });
    }
  } catch (err: unknown) {
    log.general.warn({ err, pageId: page.id }, 'Failed to tell followers of an edit');
  }
}
