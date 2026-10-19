/**
 * Service Worker — keeps the app itself so it opens without a connection,
 * and shows web push notifications.
 *
 * What it keeps, and how (`strategyFor`):
 * - A page of the app (a navigation): the network first, so a deploy is seen
 *   at once; without one, the last app it loaded (`/`, every route is the
 *   same single-page app).
 * - The app's bundles (`/_expo/static/*`): named by their content, so once
 *   kept they never change; kept the first time they are loaded.
 * - The app's icons and manifest: the network first, the copy without one.
 * - Anything else — the API, another origin, a published page — is not
 *   touched: what a member reads offline is the app's own copy of pages
 *   (IndexedDB, `lib/editor/offline-pages.ts`), never a cached response.
 */

const CACHE = 'nilo-app-v1';
const SHELL = '/';
const STATIC = /^\/_expo\/static\//;
const ASSETS = /^\/(icon-\d+\.png|manifest\.json|canvaskit\.wasm)$/;

/** How a request is answered: 'shell', 'immutable', 'asset', or null to leave it alone. */
function strategyFor(request, origin) {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  // Published pages are rendered by the edge for whoever asks: not the app's shell.
  if (url.pathname.startsWith('/pub/')) return null;
  if (request.mode === 'navigate') return 'shell';
  if (STATIC.test(url.pathname)) return 'immutable';
  if (ASSETS.test(url.pathname)) return 'asset';
  return null;
}

async function shell(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(SHELL, response.clone());
    return response;
  } catch (error) {
    const kept = await cache.match(SHELL);
    if (kept) return kept;
    throw error;
  }
}

async function immutable(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const kept = await cache.match(request);
    if (kept) return kept;
    throw error;
  }
}

const HANDLERS = { shell, immutable, asset };

self.addEventListener('install', (event) => {
  // The shell is kept from the start, so the first offline launch has it.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Caches of an earlier version of this worker go, and open tabs are served now.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy) event.respondWith(HANDLERS[strategy](event.request));
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nilo', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const payload = event.notification.data;
  const data = payload?.data ?? payload;
  const params = new URLSearchParams();
  if (typeof data?.blockId === 'string') params.set('blockId', data.blockId);
  if (typeof data?.commentId === 'string') params.set('comments', 'open');
  const url =
    typeof data?.pageId === 'string'
      ? `/p/${encodeURIComponent(data.pageId)}${params.size ? `?${params}` : ''}`
      : '/notifications';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Prefer a focused/visible tab, then any matching tab
      const sorted = windowClients
        .filter((c) => c.url.includes(self.location.origin))
        .sort(
          (a, b) =>
            (b.focused ? 1 : 0) - (a.focused ? 1 : 0) ||
            (b.visibilityState === 'visible' ? 1 : 0) - (a.visibilityState === 'visible' ? 1 : 0),
        );
      if (sorted.length > 0 && 'focus' in sorted[0]) {
        sorted[0].navigate(url);
        return sorted[0].focus();
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    }),
  );
});

// For `scripts/service-worker.test.ts`, which loads this file outside a browser.
if (typeof module !== 'undefined') module.exports = { strategyFor };
