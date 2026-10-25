/**
 * A subscription's feed URL is a secret: Google's "secret address", an
 * Outlook published link and an iCloud public link each let whoever holds them
 * read the calendar. It is stored only sealed (AES-256-GCM) under
 * `CALENDAR_FEED_KEY`, 32 random bytes in base64 (`openssl rand -base64 32`),
 * and found again by a keyed fingerprint (HMAC-SHA256 under a key derived from
 * it), so the table alone gives away neither the URL nor a way to test a guess.
 *
 * Without the key subscriptions are off: the routes answer 503 and the
 * refresh worker does not start. A sealed value names its key version (`v1`),
 * so a second key can be added and the old one retired later.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class FeedSecretError extends Error {}

interface FeedKeys {
  seal: Buffer;
  fingerprint: Buffer;
}

let cached: { raw: string; keys: FeedKeys | null } | null = null;

/** The keys `CALENDAR_FEED_KEY` gives, or null when it is unset or not 32 bytes. */
export function feedKeys(raw: string | undefined = process.env.CALENDAR_FEED_KEY): FeedKeys | null {
  const value = raw?.trim() ?? '';
  if (cached && cached.raw === value) return cached.keys;
  let keys: FeedKeys | null = null;
  const bytes = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ? Buffer.from(value, 'base64') : null;
  if (bytes && bytes.length === 32) {
    keys = {
      seal: bytes,
      fingerprint: Buffer.from(
        hkdfSync('sha256', bytes, Buffer.alloc(0), 'nilo calendar feed fingerprint', 32),
      ),
    };
  }
  cached = { raw: value, keys };
  return keys;
}

/** Whether `CALENDAR_FEED_KEY` is set but cannot be used. */
export function feedKeyMalformed(raw: string | undefined = process.env.CALENDAR_FEED_KEY): boolean {
  return (raw?.trim() ?? '') !== '' && feedKeys(raw) === null;
}

function requireKeys(keys: FeedKeys | null): FeedKeys {
  if (!keys) throw new FeedSecretError('CALENDAR_FEED_KEY is not set');
  return keys;
}

export function sealFeedUrl(url: string, keys: FeedKeys | null = feedKeys()): string {
  const { seal } = requireKeys(keys);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', seal, iv);
  cipher.setAAD(Buffer.from(VERSION));
  const sealed = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    sealed.toString('base64url'),
  ].join('.');
}

export function openFeedUrl(value: string, keys: FeedKeys | null = feedKeys()): string {
  const { seal } = requireKeys(keys);
  const [version, iv, tag, sealed] = value.split('.');
  if (version !== VERSION || !iv || !tag || sealed === undefined) {
    throw new FeedSecretError('Not a sealed feed URL');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', seal, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new FeedSecretError('The sealed feed URL does not open with this key');
  }
}

export function feedFingerprint(url: string, keys: FeedKeys | null = feedKeys()): string {
  const { fingerprint } = requireKeys(keys);
  return createHmac('sha256', fingerprint).update(url).digest('base64url');
}
