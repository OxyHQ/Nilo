/**
 * The browsers the API and its socket admit, through the SDK's one origin
 * check (`createOxyCors` / `createOxySocketCors`): Oxy's own HTTPS origins,
 * the web app (`WEB_URL`), production — Nilo, and Noted, whose notes Nilo
 * keeps (`routes/notes.ts`) — and local development servers. One list, so
 * HTTP and both socket transports cannot disagree. A native app sends no
 * `Origin` and needs no entry.
 */
import { createOxyCors, createOxySocketCors } from '@oxy.so/core/server';

const PRODUCTION_ORIGINS = ['https://nilo.so', 'https://noted.oxy.so'];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'http://10.0.2.2:8081',
];

function appOrigins(): string[] {
  return [
    ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
    ...PRODUCTION_ORIGINS,
    ...DEV_ORIGINS,
  ];
}

/** HTTP: downloads name their file, and rate-limited answers say when to retry. */
export const apiCors = createOxyCors({
  appOrigins: appOrigins(),
  exposedHeaders: ['Content-Disposition', 'Retry-After'],
});

/** Socket.IO: long polling (`cors`) and the WebSocket handshake (`allowRequest`). */
export const socketCors = createOxySocketCors({ appOrigins: appOrigins() });
