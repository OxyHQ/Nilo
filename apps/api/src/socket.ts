import { allowedOrigins } from './lib/allowed-origins.js';
import { observeEcosystemSocket } from './ecosystemActivity';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type http from 'node:http';
import { getRedisClient, getRedisSubClient } from './lib/redis.js';
import { log } from './lib/logger.js';
import { oxyClient } from './middleware/auth.js';
import { registerLiveRooms } from './collab/live-rooms.js';
import { registerPageDocs, SOCKET_MAX_MESSAGE_BYTES } from './collab/page-docs.js';
import { registerPageRooms } from './collab/page-rooms.js';

const ALLOWED_ORIGINS = allowedOrigins();

let io: Server | null = null;

export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: SOCKET_MAX_MESSAGE_BYTES,
  });

  io.use(oxyClient.middleware.socket());

  // The adapter is what makes a page's room reach members on every task.
  // Attached at once: the ioredis clients are already connecting (no
  // `lazyConnect`), so calling `.connect()` on them would reject and leave each
  // task with its own rooms — the bug Alia measured in production — and ioredis
  // queues the adapter's subscribe until the connection is up.
  const pubClient = getRedisClient();
  const subClient = getRedisSubClient();
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    log.general.info('Socket.IO Redis adapter attached');
  } else {
    log.general.warn('Socket.IO has no Redis adapter: rooms reach only this task');
  }

  io.on('connection', (socket) => {
    observeEcosystemSocket(socket);
    const userId: unknown = socket.data.userId;
    if (typeof userId === 'string') {
      socket.join(`user:${userId}`);
    }
    if (io) {
      registerPageRooms(io, socket);
      registerPageDocs(io, socket);
      registerLiveRooms(io, socket);
    }
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}
