/**
 * Fetching a subscribed feed: the URL rules (https only, public, default
 * port, no credentials), the guards on every hop and every resolved address,
 * HTTP caching (ETag / Last-Modified answered 304), and the refresh timing.
 * A fixture server on loopback stands in for the feed: the tests widen the
 * policy to reach it and to nothing else private.
 */
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FetchPolicy, isPublicAddress, UnsafeUrlError } from '../safe-fetch.js';
import {
  DEFAULT_REFRESH_MS,
  FEED_POLICY,
  failureDelay,
  fetchFeed,
  freshForMs,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  nextRefreshDelay,
  normalizeFeedUrl,
} from './subscriptions.js';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

let server: Server;
let origin: string;
const seen: IncomingHttpHeaders[] = [];

/** The feed policy, reaching the fixture server on loopback over http and nothing else private. */
const FIXTURE_POLICY: FetchPolicy = {
  ...FEED_POLICY,
  httpsOnly: false,
  allowPort: () => true,
  allowAddress: (address) => address === '127.0.0.1' || isPublicAddress(address),
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    const path = req.url ?? '/';
    if (path === '/etag.ics') {
      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304, { etag: '"v1"', 'cache-control': 'max-age=3600' });
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/calendar',
        etag: '"v1"',
        'cache-control': 'private, max-age=3600',
      });
      res.end(ICS);
    } else if (path === '/modified.ics') {
      const stamp = 'Tue, 03 Nov 2026 10:00:00 GMT';
      if (req.headers['if-modified-since'] === stamp) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { 'last-modified': stamp });
      res.end(ICS);
    } else if (path === '/gone.ics') {
      res.writeHead(404);
      res.end('nope');
    } else if (path === '/html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>sign in</html>');
    } else if (path === '/huge.ics') {
      res.writeHead(200);
      res.write('BEGIN:VCALENDAR\r\n');
      const chunk = `X-PAD:${'x'.repeat(64 * 1024)}\r\n`;
      for (let i = 0; i < 90; i += 1) res.write(chunk);
      res.end('END:VCALENDAR\r\n');
    } else if (path === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else if (path === '/to-private-name') {
      res.writeHead(302, { location: `http://intranet.example:${port()}/etag.ics` });
      res.end();
    } else if (path === '/to-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
    } else if (path === '/hop') {
      res.writeHead(301, { location: '/etag.ics' });
      res.end();
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${port()}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const port = () => (server.address() as AddressInfo).port;
const none = { etag: null, lastModified: null };

describe('the URL a subscription may have', () => {
  it('reads webcal:// and webcals:// as https://, and drops a fragment', () => {
    expect(normalizeFeedUrl('webcal://p01-caldav.icloud.com/published/2/abc').toString()).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    );
    expect(normalizeFeedUrl(' WEBCALS://example.com/a.ics#x ').toString()).toBe(
      'https://example.com/a.ics',
    );
  });

  it('refuses http, other schemes and ports, credentials, and private or internal hosts', () => {
    for (const url of [
      'http://calendar.google.com/calendar/ical/x/basic.ics',
      'ftp://example.com/a.ics',
      'file:///etc/passwd',
      'https://example.com:8443/a.ics',
      'https://example.com:80/a.ics',
      'https://ada:secret@example.com/a.ics',
      'https://127.0.0.1/a.ics',
      'https://10.0.0.8/a.ics',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/a.ics',
      'https://[::ffff:7f00:1]/a.ics',
      'https://[fd00::1]/a.ics',
      'https://localhost/a.ics',
      'https://metadata.google.internal/a.ics',
      'https://printer.local/a.ics',
      'not a url',
    ]) {
      expect(() => normalizeFeedUrl(url), url).toThrow(UnsafeUrlError);
    }
  });
});

describe('fetching a feed', () => {
  it('never reaches the server itself, by address or by a name that resolves to it', async () => {
    expect(await fetchFeed(`${origin}/etag.ics`, none)).toEqual({
      kind: 'failed',
      error: 'unsafe_url',
      httpStatus: null,
    });
    const toLoopback: FetchPolicy = {
      ...FEED_POLICY,
      lookup: (_host, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
    };
    expect(await fetchFeed('https://calendar.example/feed.ics', none, toLoopback)).toMatchObject({
      error: 'unsafe_url',
    });
    const mixed: FetchPolicy = {
      ...FEED_POLICY,
      lookup: (_host, callback) =>
        callback(null, [
          { address: '93.184.216.34', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
    };
    expect(await fetchFeed('https://calendar.example/feed.ics', none, mixed)).toMatchObject({
      error: 'unsafe_url',
    });
  });

  it('checks every redirect: metadata, a name resolving inside, another scheme', async () => {
    const insideName: FetchPolicy = {
      ...FIXTURE_POLICY,
      lookup: (host, callback) =>
        host === 'intranet.example'
          ? callback(null, [{ address: '10.1.2.3', family: 4 }])
          : callback(null, [{ address: '127.0.0.1', family: 4 }]),
    };
    for (const path of ['/to-metadata', '/to-private-name', '/to-file']) {
      expect(await fetchFeed(`${origin}${path}`, none, insideName), path).toEqual({
        kind: 'failed',
        error: 'unsafe_url',
        httpStatus: null,
      });
    }
    expect(await fetchFeed(`${origin}/hop`, none, FIXTURE_POLICY)).toMatchObject({
      kind: 'document',
    });
  });

  it('keeps the ETag and answers 304 as unchanged, with the max-age it gave', async () => {
    const first = await fetchFeed(`${origin}/etag.ics`, none, FIXTURE_POLICY);
    expect(first).toMatchObject({
      kind: 'document',
      body: ICS,
      validators: { etag: '"v1"', lastModified: null },
      maxAgeMs: 3_600_000,
    });
    const again = await fetchFeed(
      `${origin}/etag.ics`,
      { etag: '"v1"', lastModified: null },
      FIXTURE_POLICY,
    );
    expect(again).toEqual({
      kind: 'unchanged',
      validators: { etag: '"v1"', lastModified: null },
      maxAgeMs: 3_600_000,
    });
  });

  it('sends Last-Modified back as If-Modified-Since', async () => {
    const first = await fetchFeed(`${origin}/modified.ics`, none, FIXTURE_POLICY);
    expect(first.kind).toBe('document');
    if (first.kind !== 'document') return;
    const again = await fetchFeed(`${origin}/modified.ics`, first.validators, FIXTURE_POLICY);
    expect(again.kind).toBe('unchanged');
  });

  it('sends no credentials: no Authorization, no Cookie', async () => {
    seen.length = 0;
    await fetchFeed(`${origin}/etag.ics`, none, FIXTURE_POLICY);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBeUndefined();
    expect(seen[0]?.cookie).toBeUndefined();
    expect(seen[0]?.['user-agent']).toMatch(/^Nilo-Calendar\//);
  });

  it('names what went wrong: an error status, not a calendar, too large', async () => {
    expect(await fetchFeed(`${origin}/gone.ics`, none, FIXTURE_POLICY)).toEqual({
      kind: 'failed',
      error: 'http_error',
      httpStatus: 404,
    });
    expect(await fetchFeed(`${origin}/html`, none, FIXTURE_POLICY)).toMatchObject({
      error: 'not_a_calendar',
    });
    expect(await fetchFeed(`${origin}/huge.ics`, none, FIXTURE_POLICY)).toMatchObject({
      error: 'too_large',
    });
    expect(await fetchFeed('https://nothing.invalid/a.ics', none)).toMatchObject({
      error: 'unreachable',
    });
  });
});

describe('when to read a feed again', () => {
  it('follows max-age, then Expires, within the bounds', () => {
    expect(freshForMs({ 'cache-control': 'public, max-age=7200' })).toBe(7_200_000);
    expect(
      freshForMs({
        expires: 'Tue, 03 Nov 2026 11:00:00 GMT',
        date: 'Tue, 03 Nov 2026 10:00:00 GMT',
      }),
    ).toBe(3_600_000);
    expect(freshForMs({ 'cache-control': 'no-cache' })).toBeNull();
    expect(nextRefreshDelay(null)).toBe(DEFAULT_REFRESH_MS);
    expect(nextRefreshDelay(0)).toBe(DEFAULT_REFRESH_MS);
    expect(nextRefreshDelay(60_000)).toBe(MIN_REFRESH_MS);
    expect(nextRefreshDelay(7_200_000)).toBe(7_200_000);
    expect(nextRefreshDelay(30 * 86_400_000)).toBe(MAX_REFRESH_MS);
  });

  it('backs off after failures, doubling up to a day', () => {
    expect(failureDelay(1)).toBe(MIN_REFRESH_MS);
    expect(failureDelay(2)).toBe(2 * MIN_REFRESH_MS);
    expect(failureDelay(3)).toBe(4 * MIN_REFRESH_MS);
    expect(failureDelay(50)).toBe(MAX_REFRESH_MS);
  });
});
