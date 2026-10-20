/**
 * Real-time page rooms over Socket.IO.
 *
 * A client joins `page:<id>` to take part in the page's document
 * (`page-docs.ts`) and to see who else is there. Joining requires membership of
 * the page's workspace (any role can watch). The Redis adapter, when present,
 * carries room traffic across API instances.
 */
import type { Server, Socket } from 'socket.io';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { findPageById } from '../repositories/pages.js';
import { resolvePageAccess } from '../lib/page-access.js';
import { type PageSelection, readPageSelection } from './page-selection.js';

const ID_PATTERN = /^[0-9a-f-]{24,36}$/i;

export const pageRoom = (pageId: string) => `page:${pageId}`;

/**
 * One collaborator in a page: who, which block their caret is in, and where
 * in its text (`page-selection.ts`) when they told.
 */
export interface PagePresence {
  userId: string;
  blockId: string | null;
  selection: PageSelection | null;
}

type Ack = (response: { ok: true } | { ok: false; error: string }) => void;

/** Where a socket is in a page. */
interface Focus {
  blockId: string | null;
  selection: PageSelection | null;
}

interface SocketData {
  userId?: string;
  /** Per joined page. */
  focus?: Record<string, Focus>;
}

const NO_FOCUS: Focus = { blockId: null, selection: null };

const rank = ({ blockId, selection }: Focus) => (selection ? 2 : blockId ? 1 : 0);

async function sendPresence(io: Server, pageId: string): Promise<void> {
  const sockets = await io.in(pageRoom(pageId)).fetchSockets();
  const byUser = new Map<string, PagePresence>();
  for (const s of sockets) {
    const data = s.data as SocketData;
    if (!data.userId) continue;
    const { blockId, selection } = data.focus?.[pageId] ?? NO_FOCUS;
    // One per person: the tab they are selecting in, else one with a caret.
    const existing = byUser.get(data.userId);
    if (!existing || rank(existing) < rank({ blockId, selection })) {
      byUser.set(data.userId, { userId: data.userId, blockId, selection });
    }
  }
  io.to(pageRoom(pageId)).emit('page:presence', { pageId, users: [...byUser.values()] });
}

/**
 * Pages whose presence is being sent from this task, and those changed again
 * meanwhile. A selection moves as someone types: each change does not cost a
 * round of `fetchSockets` across tasks, one follows the one in flight with
 * everything changed since.
 */
const sending = new Set<string>();
const again = new Set<string>();

async function broadcastPresence(io: Server, pageId: string): Promise<void> {
  if (sending.has(pageId)) {
    again.add(pageId);
    return;
  }
  sending.add(pageId);
  try {
    do {
      again.delete(pageId);
      await sendPresence(io, pageId);
    } while (again.has(pageId));
  } catch (err: unknown) {
    log.general.error({ err, pageId }, 'page presence failed');
  } finally {
    sending.delete(pageId);
    again.delete(pageId);
  }
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
      // A page in the trash is joined to be read; `doc:update` refuses it.
      if (!page) {
        reply({ ok: false, error: 'Page not found' });
        return;
      }
      // The same rule as the page's routes: a guest it is shared with joins,
      // a member shut out of a restricted page does not.
      const access = await resolvePageAccess(db, data.userId, page.id);
      if (!access) {
        reply({ ok: false, error: 'Forbidden' });
        return;
      }
      await socket.join(pageRoom(pageId));
      data.focus = { ...data.focus, [pageId]: NO_FOCUS };
      reply({ ok: true });
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

  // Where this member is: a block, and the text selected in it (Bloom's
  // relative selection), which must be in that block.
  socket.on('page:focus', async (payload: unknown) => {
    const { pageId, blockId, selection } = (payload ?? {}) as {
      pageId?: unknown;
      blockId?: unknown;
      selection?: unknown;
    };
    if (typeof pageId !== 'string' || !socket.rooms.has(pageRoom(pageId))) return;
    const block = typeof blockId === 'string' && ID_PATTERN.test(blockId) ? blockId : null;
    data.focus = {
      ...data.focus,
      [pageId]: { blockId: block, selection: readPageSelection(selection, block) },
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
