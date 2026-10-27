import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FeedSecretError,
  feedFingerprint,
  feedKeyMalformed,
  feedKeys,
  openFeedUrl,
  sealFeedUrl,
} from './feed-secret.js';

const SECRET =
  'https://calendar.google.com/calendar/ical/ada%40example.com/private-0123456789abcdef/basic.ics';
const keyA = feedKeys(randomBytes(32).toString('base64'));
const keyB = feedKeys(randomBytes(32).toString('base64'));

describe('sealing a feed URL', () => {
  it('opens what it sealed, and the sealed form shows nothing of the URL', () => {
    const sealed = sealFeedUrl(SECRET, keyA);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('google');
    expect(sealed).not.toContain('private');
    expect(openFeedUrl(sealed, keyA)).toBe(SECRET);
    expect(sealFeedUrl(SECRET, keyA)).not.toBe(sealed);
  });

  it('refuses another key, a changed ciphertext and a value that is not sealed', () => {
    const sealed = sealFeedUrl(SECRET, keyA);
    expect(() => openFeedUrl(sealed, keyB)).toThrow(FeedSecretError);
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3] as string, 'base64url');
    body[0] = (body[0] as number) ^ 1;
    parts[3] = body.toString('base64url');
    expect(() => openFeedUrl(parts.join('.'), keyA)).toThrow(FeedSecretError);
    expect(() => openFeedUrl(SECRET, keyA)).toThrow(FeedSecretError);
  });

  it('fingerprints the same URL the same way under one key only', () => {
    expect(feedFingerprint(SECRET, keyA)).toBe(feedFingerprint(SECRET, keyA));
    expect(feedFingerprint(SECRET, keyA)).not.toBe(feedFingerprint(SECRET, keyB));
    expect(feedFingerprint(`${SECRET}?x`, keyA)).not.toBe(feedFingerprint(SECRET, keyA));
  });

  it('is off without a key, and tells a malformed key from none', () => {
    expect(feedKeys('')).toBeNull();
    expect(feedKeys('c2hvcnQ=')).toBeNull();
    expect(feedKeyMalformed('c2hvcnQ=')).toBe(true);
    expect(feedKeyMalformed('')).toBe(false);
    expect(feedKeyMalformed(randomBytes(32).toString('base64'))).toBe(false);
    expect(() => sealFeedUrl(SECRET, null)).toThrow(FeedSecretError);
  });
});
