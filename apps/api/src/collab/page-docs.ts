/**
 * A page's document over its Socket.IO room (`page-rooms.ts`).
 *
 * A client that joined `page:<id>` (which checks it may read the page):
 *
 * - `doc:sync { pageId, stateVector }` → `{ update, stateVector }`: what the
 *   server has that the client lacks, and the server's state vector, from
 *   which the client sends what the server lacks. The Yjs sync handshake,
 *   both ways, after a reconnect or offline work as on first open.
 * - `doc:update { pageId, update }` → `{ ok }`: one change, from someone who
 *   may edit the page. Stored, sent to everyone else in the room
 *   (`doc:update`), and projected once the burst settles.
 *
 * A member's role is checked again at most every few seconds per page, so
 * losing edit access takes effect without a database read per keystroke.
 */
import type { Server, Socket } from 'socket.io';
import * as Y from 'yjs';
import { getDb } from '../db/client.js';
import { hasRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { resolvePageAccess } from '../lib/page-access.js';
import { appendUpdate, loadPageState, PageDocRejected } from '../lib/page-docs.js';
import { scheduleProjection } from '../lib/page-projection.js';
import { pageRoom } from './page-rooms.js';

type Ack<T> = (response: ({ ok: true } & T) | { ok: false; error: string; code?: string }) => void;

interface SocketData {
  userId?: string;
  /** Whether the socket may edit each page, and when that was read. */
  canEdit?: Record<string, { allowed: boolean; at: number }>;
}

const ROLE_TTL_MS = 10_000;

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

async function mayEdit(data: SocketData, pageId: string): Promise<boolean> {
  const cached = data.canEdit?.[pageId];
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) return cached.allowed;
  const access = data.userId ? await resolvePageAccess(getDb(), data.userId, pageId) : null;
  const allowed = access !== null && hasRole(access.role, 'editor');
  data.canEdit = { ...data.canEdit, [pageId]: { allowed, at: Date.now() } };
  return allowed;
}

/** Send a page's update to its room, except the socket it came from. */
export function broadcastDocUpdate(
  io: Server | null,
  pageId: string,
  update: Uint8Array,
  exceptSocketId?: string,
): void {
  if (!io) return;
  const room = io.to(pageRoom(pageId));
  (exceptSocketId ? room.except(exceptSocketId) : room).emit('doc:update', { pageId, update });
}

export function registerPageDocs(io: Server, socket: Socket): void {
  const data = socket.data as SocketData;

  socket.on(
    'doc:sync',
    async (payload: unknown, ack?: Ack<{ update: Uint8Array; stateVector: Uint8Array }>) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const { pageId, stateVector } = (payload ?? {}) as {
        pageId?: unknown;
        stateVector?: unknown;
      };
      try {
        if (typeof pageId !== 'string' || !socket.rooms.has(pageRoom(pageId))) {
          reply({ ok: false, error: 'Join the page first' });
          return;
        }
        const { state } = await loadPageState(getDb(), pageId);
        const vector = bytes(stateVector);
        reply({
          ok: true,
          update: vector ? Y.diffUpdate(state, vector) : state,
          stateVector: Y.encodeStateVectorFromUpdate(state),
        });
      } catch (err: unknown) {
        if (err instanceof PageDocRejected) {
          reply({ ok: false, error: err.message, ...(err.code && { code: err.code }) });
          return;
        }
        log.general.error({ err, pageId }, 'doc:sync failed');
        reply({ ok: false, error: 'Sync failed' });
      }
    },
  );

  socket.on('doc:update', async (payload: unknown, ack?: Ack<object>) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { pageId, update } = (payload ?? {}) as { pageId?: unknown; update?: unknown };
    try {
      const change = bytes(update);
      if (typeof pageId !== 'string' || !socket.rooms.has(pageRoom(pageId)) || !change) {
        reply({ ok: false, error: 'Join the page first' });
        return;
      }
      if (!data.userId || !(await mayEdit(data, pageId))) {
        reply({ ok: false, error: 'Read-only', code: 'READ_ONLY' });
        return;
      }
      await appendUpdate(getDb(), { pageId, update: change, actorId: data.userId });
      broadcastDocUpdate(io, pageId, change, socket.id);
      scheduleProjection(pageId, data.userId);
      reply({ ok: true });
    } catch (err: unknown) {
      if (err instanceof PageDocRejected) {
        reply({ ok: false, error: err.message, ...(err.code && { code: err.code }) });
        return;
      }
      log.general.error({ err, pageId }, 'doc:update failed');
      reply({ ok: false, error: 'Update failed' });
    }
  });
}
