/**
 * Real-time page rooms over Socket.IO.
 *
 * A client joins `page:<id>` to receive the transactions other members apply
 * to that page and to see who else is there. Joining requires membership of
 * the page's workspace (any role can watch). The Redis adapter, when present,
 * carries room traffic across API instances.
 */
import type { Server, Socket } from 'socket.io';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { findPageById } from '../repositories/pages.js';
import { findMembership } from '../repositories/workspaces.js';

const ID_PATTERN = /^[0-9a-f-]{24,36}$/i;

export const pageRoom = (pageId: string) => `page:${pageId}`;

/** One collaborator in a page: who, and which block their caret is in. */
export interface PagePresence {
  userId: string;
  blockId: string | null;
}

type Ack = (response: { ok: true; version: number } | { ok: false; error: string }) => void;

interface SocketData {
  userId?: string;
  /** The focused block per joined page. */
  focus?: Record<string, string | null>;
}

async function broadcastPresence(io: Server, pageId: string): Promise<void> {
  const sockets = await io.in(pageRoom(pageId)).fetchSockets();
  const byUser = new Map<string, PagePresence>();
  for (const s of sockets) {
    const data = s.data as SocketData;
    if (!data.userId) continue;
    const blockId = data.focus?.[pageId] ?? null;
    const existing = byUser.get(data.userId);
    if (!existing || (existing.blockId === null && blockId !== null)) {
      byUser.set(data.userId, { userId: data.userId, blockId });
    }
  }
  io.to(pageRoom(pageId)).emit('page:presence', { pageId, users: [...byUser.values()] });
}

export function registerPageRooms(io: Server, socket: Socket): void {
  const data = socket.data as SocketData;

  socket.on('page:join', async (pageId: unknown, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => {};
    try {
      if (typeof pageId !== 'string' || !ID_PATTERN.test(pageId) || !data.userId) {
        reply({ ok: false, error: 'Invalid page' });
        return;
      }
      const db = getDb();
      const page = await findPageById(db, pageId);
      if (!page || page.archived) {
        reply({ ok: false, error: 'Page not found' });
        return;
      }
      const member = await findMembership(db, page.workspaceId, data.userId);
      if (!member) {
        reply({ ok: false, error: 'Forbidden' });
        return;
      }
      await socket.join(pageRoom(pageId));
      data.focus = { ...data.focus, [pageId]: null };
      reply({ ok: true, version: page.blocksVersion });
      await broadcastPresence(io, pageId);
    } catch (err: unknown) {
      log.general.error({ err, pageId }, 'page:join failed');
      reply({ ok: false, error: 'Join failed' });
    }
  });

  socket.on('page:leave', async (pageId: unknown) => {
    if (typeof pageId !== 'string' || !socket.rooms.has(pageRoom(pageId))) return;
    await socket.leave(pageRoom(pageId));
    if (data.focus) delete data.focus[pageId];
    await broadcastPresence(io, pageId);
  });

  socket.on('page:focus', async (payload: unknown) => {
    const { pageId, blockId } = (payload ?? {}) as { pageId?: unknown; blockId?: unknown };
    if (typeof pageId !== 'string' || !socket.rooms.has(pageRoom(pageId))) return;
    data.focus = {
      ...data.focus,
      [pageId]: typeof blockId === 'string' && ID_PATTERN.test(blockId) ? blockId : null,
    };
    await broadcastPresence(io, pageId);
  });

  socket.on('disconnecting', () => {
    const pages = [...socket.rooms]
      .filter((room) => room.startsWith('page:'))
      .map((room) => room.slice(5));
    // After the socket has left its rooms, so it is not counted.
    setImmediate(() => {
      for (const pageId of pages) void broadcastPresence(io, pageId);
    });
  });
}

/** The payload every member of a page receives when a transaction is applied. */
export interface PageTransactionEvent {
  pageId: string;
  /** The page's blocks version after this transaction. */
  version: number;
  /** Who applied it. */
  actorId: string;
  ops: unknown[];
}

/**
 * Send an applied transaction to the page's room, except the socket that
 * made it (it already has the change).
 */
export function broadcastPageTransaction(
  io: Server | null,
  event: PageTransactionEvent,
  exceptSocketId?: string,
): void {
  if (!io) return;
  const room = io.to(pageRoom(event.pageId));
  (exceptSocketId ? room.except(exceptSocketId) : room).emit('page:transaction', event);
}
