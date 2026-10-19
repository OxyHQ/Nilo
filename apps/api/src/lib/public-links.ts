import crypto from 'node:crypto';

const TOKEN_BYTES = 24; // base64url of 24 random bytes ≈ 32 chars

/** A link's secret: base64url (RFC 4648 §5), no padding, only [A-Za-z0-9_-]. */
export function generateLinkToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Whether `token` could be one `generateLinkToken` made, before any lookup. */
export function plausibleLinkToken(token: string | null): token is string {
  return !!token && token.length >= 8 && token.length <= 128;
}

/**
 * `path` on the app's public origin (`OXYNILO_PUBLIC_URL`), the address a
 * link hands out: `/share/<token>` for a page, `/join/<token>` for a
 * workspace.
 */
export function publicAppUrl(path: string): string {
  const configuredOrigin = process.env.OXYNILO_PUBLIC_URL;
  if (!configuredOrigin) {
    throw new Error('OXYNILO_PUBLIC_URL is required to create share links');
  }
  const origin = new URL(configuredOrigin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('OXYNILO_PUBLIC_URL must be an HTTP(S) origin');
  }
  return `${origin.origin}${path}`;
}
