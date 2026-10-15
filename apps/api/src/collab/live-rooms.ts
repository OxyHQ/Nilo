/**
 * Live updates outside the editor, over Socket.IO: the sidebar and database
 * views follow what other members change.
 *
 * - `workspace:join` (a member of the workspace, or someone a page of it is
 *   shared with) joins `workspace:<id>`, told `workspace:changed` when its
 *   page tree changes (a page made, renamed, moved, archived…).
 * - `database:join` (anyone who can open the database) joins
 *   `database:<id>`, told `database:changed` when its rows, properties or
 *   views change.
 *
 * The events carry ids only, never content: clients read again through the
 * API, which applies the access rule. Bursts are coalesced per room.
 */
import type { Server, Socket } from 'socket.io';
import { getDb } from '../db/client.js';
import { resolveDatabaseRole } from '../lib/page-access.js';
import { log } from '../lib/logger.js';
import { findDatabaseById } from '../repositories/databases.js';
import { listGrantsOfUserInWorkspace } from '../repositories/pagePermissions.js';
import { findMembership } from '../repositories/workspaces.js';
import { getIO } from '../socket.js';
import { pageRoom } from './page-rooms.js';

const ID_PATTERN = /^[0-9a-f-]{24,36}$/i;

export const workspaceRoom = (id: string) => `workspace:${id}`;
export const databaseRoom = (id: string) => `database:${id}`;

type Ack = (response: { ok: boolean; error?: string }) => void;

export function registerLiveRooms(_io: Server, socket: Socket): void {
  const userId = () => (socket.data as { userId?: string }).userId;
  const reply = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

  socket.on('workspace:join', async (workspaceId: unknown, ack?: Ack) => {
    const answer = reply(ack);
    try {
      const user = userId();
      if (!user || typeof workspaceId !== 'string' || !ID_PATTERN.test(workspaceId)) {
        answer({ ok: false, error: 'Invalid' });
        return;
      }
      const db = getDb();
      const member = await findMembership(db, workspaceId, user);
      const allowed =
        member || (await listGrantsOfUserInWorkspace(db, user, workspaceId)).length > 0;
      if (!allowed) {
        answer({ ok: false, error: 'Forbidden' });
        return;
      }
      await socket.join(workspaceRoom(workspaceId));
      answer({ ok: true });
    } catch (err: unknown) {
      log.general.error({ err, workspaceId }, 'workspace:join failed');
      answer({ ok: false, error: 'Join failed' });
    }
  });

  socket.on('workspace:leave', async (workspaceId: unknown) => {
    if (typeof workspaceId === 'string') await socket.leave(workspaceRoom(workspaceId));
  });

  socket.on('database:join', async (databaseId: unknown, ack?: Ack) => {
    const answer = reply(ack);
    try {
      const user = userId();
      if (!user || typeof databaseId !== 'string' || !ID_PATTERN.test(databaseId)) {
        answer({ ok: false, error: 'Invalid' });
        return;
      }
      const db = getDb();
      const database = await findDatabaseById(db, databaseId);
      if (!database || !(await resolveDatabaseRole(db, user, database))) {
        answer({ ok: false, error: 'Forbidden' });
        return;
      }
      await socket.join(databaseRoom(databaseId));
      answer({ ok: true });
    } catch (err: unknown) {
      log.general.error({ err, databaseId }, 'database:join failed');
      answer({ ok: false, error: 'Join failed' });
    }
  });

  socket.on('database:leave', async (databaseId: unknown) => {
    if (typeof databaseId === 'string') await socket.leave(databaseRoom(databaseId));
  });
}

const COALESCE_MS = 150;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function emitSoon(room: string, event: string, payload: Record<string, string>): void {
  if (pending.has(room)) return;
  pending.set(
    room,
    setTimeout(() => {
      pending.delete(room);
      getIO()?.to(room).emit(event, payload);
    }, COALESCE_MS),
  );
}

/** A page's comments changed (made, edited, resolved, deleted, reacted to): its room hears. */
export function announceComments(pageId: string): void {
  emitSoon(pageRoom(pageId), 'page:comments', { pageId });
}

/**
 * Something changed: a workspace's page tree, and/or a database. Called by
 * the routes once a write has committed.
 */
export function announceChange(change: { workspaceId?: string; databaseId?: string | null }): void {
  if (change.workspaceId) {
    emitSoon(workspaceRoom(change.workspaceId), 'workspace:changed', {
      workspaceId: change.workspaceId,
    });
  }
  if (change.databaseId) {
    emitSoon(databaseRoom(change.databaseId), 'database:changed', {
      databaseId: change.databaseId,
    });
  }
}
