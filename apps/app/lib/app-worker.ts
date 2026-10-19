import { Platform } from 'react-native';

/**
 * Hand the web app to its service worker (`public/sw.js`), which keeps it so
 * it opens without a connection. Not in development: a kept bundle would
 * hide the one the dev server is serving.
 */
export function registerAppWorker(): void {
  if (Platform.OS !== 'web' || __DEV__) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
    console.warn('[app-worker] the app will need a connection to open', err);
  });
}
