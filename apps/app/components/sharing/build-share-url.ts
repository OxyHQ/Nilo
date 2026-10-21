import { Platform } from 'react-native';

/**
 * Resolve the public host that serves the app's links: `/share/[token]`,
 * `/pub/…`, `/form/…`, and a page's own (`blockLink`).
 * Priority:
 *   1. EXPO_PUBLIC_WEB_URL (set in CI/staging/prod env)
 *   2. window.location.origin (web only)
 *   3. Production fallback `https://nilo.so`
 */
export function resolveWebOrigin(): string {
  if (process.env.EXPO_PUBLIC_WEB_URL) {
    return process.env.EXPO_PUBLIC_WEB_URL.replace(/\/$/, '');
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://nilo.so';
}

export function buildShareUrl(token: string): string {
  return `${resolveWebOrigin()}/share/${token}`;
}

export function buildPageUrl(pageId: string): string {
  return `${resolveWebOrigin()}/p/${encodeURIComponent(pageId)}`;
}

export function buildPublishUrl(slug: string): string {
  return `${resolveWebOrigin()}/pub/${encodeURIComponent(slug)}`;
}

export function buildFormUrl(token: string): string {
  return `${resolveWebOrigin()}/form/${encodeURIComponent(token)}`;
}
