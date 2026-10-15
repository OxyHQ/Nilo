import { io, type Socket } from 'socket.io-client';
import { currentAccessToken } from '../api/client';
import config from '../config';

/**
 * One Socket.IO connection for the whole app, shared by everything that
 * listens in real time (notifications, page rooms). Held by reference count:
 * the connection opens with the first holder and closes with the last.
 */
let socket: Socket | null = null;
let holders = 0;

export function acquireSocket(): Socket {
  if (!socket) {
    socket = io(config.apiUrl, {
      auth: (callback) => {
        const token = currentAccessToken();
        callback(token ? { token } : {});
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  holders += 1;
  return socket;
}

export function releaseSocket(): void {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && socket) {
    socket.disconnect();
    socket = null;
  }
}
