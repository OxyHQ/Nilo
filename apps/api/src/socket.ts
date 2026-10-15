import { allowedOrigins } from './lib/allowed-origins.js';
import { observeEcosystemSocket } from './ecosystemActivity';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type http from 'node:http';
import { getRedisClient, getRedisSubClient } from './lib/redis.js';
import { log } from './lib/logger.js';
import { oxyClient } from './middleware/auth.js';
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
  });

  io.use(oxyClient.middleware.socket());

  const pubClient = getRedisClient();
  const subClient = getRedisSubClient();
  if (pubClient && subClient) {
    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io?.adapter(createAdapter(pubClient, subClient));
        log.general.info('Socket.IO Redis adapter attached');
      })
      .catch((error: unknown) => {
        log.general.warn({ err: error }, 'Socket.IO Redis adapter failed; using in-memory');
      });
  }

  io.on('connection', (socket) => {
    observeEcosystemSocket(socket);
    const userId: unknown = socket.data.userId;
    if (typeof userId === 'string') {
      socket.join(`user:${userId}`);
    }
    if (io) registerPageRooms(io, socket);
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}
