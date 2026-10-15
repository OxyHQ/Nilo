/**
 * Fetching a URL a user gave us, without letting them aim the server at
 * itself or its network (SSRF): the cloud metadata service, the VPC, local
 * ports.
 *
 * - Only http and https, on their default ports.
 * - Every address a host resolves to must be public; the connection is made
 *   to the address that was checked (the request's `lookup`), so a DNS answer
 *   cannot change between the check and the connection.
 * - Redirects are followed by hand, each hop checked the same way.
 * - Bounded time and size.
 */
import dns from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';

const BLOCKED = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(prefix, bits, 'ipv6');
}

/** The IPv4 address an IPv6 one carries (mapped `::ffff:a.b.c.d`, NAT64 `64:ff9b::/96`), if any. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return mapped[1] as string;
  const hexMapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1] as string, 16);
    const low = Number.parseInt(hexMapped[2] as string, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  return nat64 ? (nat64[1] as string) : null;
}

/** Whether a server may connect to this address on a user's behalf. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  const inner = embeddedIpv4(address);
  if (inner) return !BLOCKED.check(inner, 'ipv4');
  return !BLOCKED.check(address, 'ipv6');
}

export class UnsafeUrlError extends Error {}

/** Resolve like `dns.lookup`, refusing any answer that is not public. */
function publicLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError(`${hostname} does not resolve to a public address`), '');
    }
    const first = list[0] as dns.LookupAddress;
    if (options.all) return callback(null, [first]);
    callback(null, first.address, first.family);
  });
}

/** The URL if it is one a user may make us fetch; throws otherwise. */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UnsafeUrlError('Only http and https');
  if (url.port && url.port !== '80' && url.port !== '443')
    throw new UnsafeUrlError('Only the default ports');
  if (url.username || url.password) throw new UnsafeUrlError('No credentials in URLs');
  // An address written as the host is never looked up: check it here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError('Not a public address');
  if (/^localhost$|\.localhost$|\.internal$|\.local$/i.test(host))
    throw new UnsafeUrlError('Not a public host');
  return url;
}

export interface SafeResponse {
  status: number;
  contentType: string;
  finalUrl: string;
  /** The body as UTF-8 text. */
  body: string;
  /** The body as received, for binary content. */
  bytes: Buffer;
  /** Whether the body was cut off at `maxBytes` or the deadline. */
  truncated: boolean;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Accept the response only if its content type passes. */
  accept?: (contentType: string) => boolean;
}

function requestOnce(
  url: URL,
  options: Required<Omit<SafeFetchOptions, 'maxRedirects' | 'accept'>>,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      { headers: options.headers, lookup: publicLookup as never, timeout: options.timeoutMs },
      resolve,
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

/** GET a user-supplied URL safely (see the module comment). */
export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const settings = {
    timeoutMs: options.timeoutMs ?? 8000,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    headers: options.headers ?? {},
  };
  const deadline = Date.now() + settings.timeoutMs;
  let url = checkUrl(raw);
  for (let hop = 0; hop <= (options.maxRedirects ?? 4); hop += 1) {
    const res = await requestOnce(url, {
      ...settings,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = checkUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (options.accept && !options.accept(contentType)) {
      res.destroy();
      return {
        status,
        contentType,
        finalUrl: url.toString(),
        body: '',
        bytes: Buffer.alloc(0),
        truncated: false,
      };
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let truncated = false;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      received += chunk.length;
      if (received > settings.maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (received - settings.maxBytes)));
        res.destroy();
        truncated = true;
        break;
      }
      chunks.push(chunk);
      if (Date.now() > deadline) {
        res.destroy();
        truncated = true;
        break;
      }
    }
    const bytes = Buffer.concat(chunks);
    return {
      status,
      contentType,
      finalUrl: url.toString(),
      body: bytes.toString('utf8'),
      bytes,
      truncated,
    };
  }
  throw new UnsafeUrlError('Too many redirects');
}

/**
 * Throws unless `raw` is an https URL whose host resolves only to public
 * addresses: for URLs a library will call later (a Web Push endpoint).
 */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  const url = checkUrl(raw);
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return url;
  const addresses = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
    throw new UnsafeUrlError(`${host} does not resolve to a public address`);
  }
  return url;
}
