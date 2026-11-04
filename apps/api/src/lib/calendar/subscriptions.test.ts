/**
 * Fetching a subscribed feed: the URL rules (https on its default port, no
 * credentials), the SDK's guard on every address, HTTP caching (ETag /
 * Last-Modified answered 304), and the refresh timing.
 *
 * The guard itself is `@oxy.so/core`'s `safeFetch`, which refuses loopback by
 * design; the tests that need a feed read a fixture server on loopback
 * through a reader that maps `https://feeds.test` to it, and hand every other
 * host — a redirect's included — to the real, guarded reader.
 */
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PublicReadOptions, readPublicUrl } from '../public-fetch.js';
import { SsrfRejection } from '@oxy.so/core/server';
import {
  DEFAULT_REFRESH_MS,
  FeedUrlError,
  failureDelay,
  fetchFeed,
  freshForMs,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  nextRefreshDelay,
  normalizeFeedUrl,
  scrubbedError,
} from './subscriptions.js';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const FEEDS = 'https://feeds.test';

let server: Server;
const seen: IncomingHttpHeaders[] = [];

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
    } else if (path === '/cut.ics') {
      res.writeHead(200);
      res.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\n');
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
    } else if (path === '/to-loopback') {
      res.writeHead(302, { location: 'https://127.0.0.1/etag.ics' });
      res.end();
    } else if (path === '/to-plain-http') {
      // Leaves the fixture, so the SDK's own guard (`requireHttps`) meets it.
      res.writeHead(302, { location: 'http://feeds.example/etag.ics' });
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const port = () => (server.address() as AddressInfo).port;
const none = { etag: null, lastModified: null };

/**
 * `feeds.test` (https or http) is the fixture server; anything else goes to
 * the real reader, so a redirect away from the fixture meets the SDK's guard.
 */
async function fixtureRead(url: string, options: PublicReadOptions) {
  const target = new URL(url);
  if (target.hostname !== 'feeds.test') return readPublicUrl(url, options);
  const res = await fetch(`http://127.0.0.1:${port()}${target.pathname}${target.search}`, {
    headers: options.headers,
    redirect: 'manual',
  });
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    return fixtureRead(new URL(location, url).toString(), options);
  }
  const answer = { status: res.status, headers: Object.fromEntries(res.headers), finalUrl: url };
  if (!options.wants(res.status, res.headers.get('content-type') ?? '')) {
    await res.body?.cancel();
    return { ...answer, kind: 'skipped' as const };
  }
  const body = Buffer.from(await res.arrayBuffer());
  return body.length > options.maxBytes
    ? { ...answer, kind: 'too_large' as const }
    : { ...answer, kind: 'ok' as const, body };
}

describe('the URL a subscription may have', () => {
  it('reads webcal:// and webcals:// as https://, and drops a fragment', () => {
    expect(normalizeFeedUrl('webcal://p01-caldav.icloud.com/published/2/abc').toString()).toBe(
      'https://p01-caldav.icloud.com/published/2/abc',
    );
    expect(normalizeFeedUrl(' WEBCALS://example.com/a.ics#x ').toString()).toBe(
      'https://example.com/a.ics',
    );
  });

  it('refuses http, other schemes and ports, and credentials', () => {
    for (const url of [
      'http://calendar.google.com/calendar/ical/x/basic.ics',
      'ftp://example.com/a.ics',
      'file:///etc/passwd',
      'https://example.com:8443/a.ics',
      'https://example.com:80/a.ics',
      'https://ada:secret@example.com/a.ics',
      'not a url',
    ]) {
      expect(() => normalizeFeedUrl(url), url).toThrow(FeedUrlError);
    }
  });
});

describe('fetching a feed', () => {
  it('never reaches the server itself or its network, by address or by name', async () => {
    for (const url of [
      `http://127.0.0.1:${port()}/etag.ics`,
      'https://127.0.0.1/a.ics',
      'https://10.0.0.8/a.ics',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/a.ics',
      'https://[::ffff:7f00:1]/a.ics',
      'https://[fd00::1]/a.ics',
      'https://localhost/a.ics',
    ]) {
      expect(await fetchFeed(url, none), url).toEqual({
        kind: 'failed',
        error: 'unsafe_url',
        httpStatus: null,
      });
    }
  });

  it('checks every redirect: metadata, loopback, plain http', async () => {
    for (const path of ['/to-metadata', '/to-loopback', '/to-plain-http']) {
      expect(await fetchFeed(`${FEEDS}${path}`, none, fixtureRead), path).toEqual({
        kind: 'failed',
        error: 'unsafe_url',
        httpStatus: null,
      });
    }
    expect(await fetchFeed(`${FEEDS}/hop`, none, fixtureRead)).toMatchObject({
      kind: 'document',
    });
  });

  it('keeps the ETag and answers 304 as unchanged, with the max-age it gave', async () => {
    const first = await fetchFeed(`${FEEDS}/etag.ics`, none, fixtureRead);
    expect(first).toMatchObject({
      kind: 'document',
      body: ICS,
      validators: { etag: '"v1"', lastModified: null },
      maxAgeMs: 3_600_000,
    });
    const again = await fetchFeed(
      `${FEEDS}/etag.ics`,
      { etag: '"v1"', lastModified: null },
      fixtureRead,
    );
    expect(again).toEqual({
      kind: 'unchanged',
      validators: { etag: '"v1"', lastModified: null },
      maxAgeMs: 3_600_000,
    });
  });

  it('sends Last-Modified back as If-Modified-Since', async () => {
    const first = await fetchFeed(`${FEEDS}/modified.ics`, none, fixtureRead);
    expect(first.kind).toBe('document');
    if (first.kind !== 'document') return;
    const again = await fetchFeed(`${FEEDS}/modified.ics`, first.validators, fixtureRead);
    expect(again.kind).toBe('unchanged');
  });

  it('sends no credentials: no Authorization, no Cookie', async () => {
    seen.length = 0;
    await fetchFeed(`${FEEDS}/etag.ics`, none, fixtureRead);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBeUndefined();
    expect(seen[0]?.cookie).toBeUndefined();
    expect(seen[0]?.['user-agent']).toMatch(/^Nilo-Calendar\//);
  });

  it('names what went wrong: an error status, not a calendar, too large', async () => {
    expect(await fetchFeed(`${FEEDS}/gone.ics`, none, fixtureRead)).toEqual({
      kind: 'failed',
      error: 'http_error',
      httpStatus: 404,
    });
    expect(await fetchFeed(`${FEEDS}/html`, none, fixtureRead)).toMatchObject({
      error: 'not_a_calendar',
    });
    expect(await fetchFeed(`${FEEDS}/huge.ics`, none, fixtureRead)).toMatchObject({
      error: 'too_large',
    });
    expect(await fetchFeed(`${FEEDS}/cut.ics`, none, fixtureRead)).toMatchObject({
      error: 'incomplete',
    });
  });

  it('asks the SDK for https on every hop, and a refused hop is unsafe', async () => {
    const asked: PublicReadOptions[] = [];
    const refusing = async (_url: string, options: PublicReadOptions) => {
      asked.push(options);
      throw new SsrfRejection('https required: redirect to a non-https url');
    };
    expect(await fetchFeed(`${FEEDS}/etag.ics`, none, refusing)).toEqual({
      kind: 'failed',
      error: 'unsafe_url',
      httpStatus: null,
    });
    expect(asked[0]?.requireHttps).toBe(true);
  });

  it('refuses a plain-http hop before connecting, with the real reader', async () => {
    // A literal public address: only `requireHttps` stops this hop before a connection.
    expect(
      await readPublicUrl('http://93.184.216.34/a.ics', {
        timeoutMs: 1_000,
        maxBytes: 1,
        wants: () => false,
        requireHttps: true,
      }).catch((error: unknown) => error),
    ).toBeInstanceOf(SsrfRejection);
  });

  it('is unreachable, not unsafe, when the request itself fails', async () => {
    const down = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    expect(await fetchFeed(`${FEEDS}/etag.ics`, none, down)).toEqual({
      kind: 'failed',
      error: 'unreachable',
      httpStatus: null,
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

describe('logging a failed refresh', () => {
  it('takes the feed URL and its secret path out of the error', () => {
    const url =
      'https://calendar.google.com/calendar/ical/ada%40example.com/private-9f8e/basic.ics';
    const err = new Error(`connect ECONNRESET ${url}`);
    Object.assign(err, { code: 'ECONNRESET' });
    err.stack = `Error: request to /calendar/ical/ada%40example.com/private-9f8e/basic.ics failed`;
    const logged = JSON.stringify(scrubbedError(err, url));
    expect(logged).not.toContain('private-9f8e');
    expect(logged).toContain('ECONNRESET');
    expect(logged).toContain('[feed url]');
  });
});
