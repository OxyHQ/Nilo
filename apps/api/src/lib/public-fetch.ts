/**
 * Reading a URL a person gave us — a link preview, an image a page embeds, a
 * calendar — without letting them aim the server at itself or its network.
 *
 * The guard is the SDK's (`@oxy.so/core/server`): `safeFetch` validates every
 * hop, pins each connection to the public address it checked and bounds the
 * wait for the headers; `readResponseBody` caps the body and gives it a
 * deadline. This only puts the two halves under one deadline. Never for Oxy's
 * own hosts: those go through `oxy` (`../oxy.ts`).
 */
import type { IncomingHttpHeaders } from 'node:http';
import { readResponseBody, safeFetch } from '@oxy.so/core/server';

export interface PublicReadOptions {
  headers?: Record<string, string>;
  /** For the whole read: the headers and then the body. */
  timeoutMs: number;
  maxBytes: number;
  /** Whether to read the body of this answer; when not, it is dropped unread. */
  wants: (status: number, contentType: string) => boolean;
  /** Refuse (`SsrfRejection`) a URL or any redirect that is not https. */
  requireHttps?: boolean;
}

interface PublicAnswer {
  status: number;
  headers: IncomingHttpHeaders;
  finalUrl: string;
}

/**
 * `ok` with the whole body; `skipped` when `wants` declined it; `too_large`,
 * `timeout` or `error` when the body could not be read whole.
 */
export type PublicRead =
  | (PublicAnswer & { kind: 'ok'; body: Buffer })
  | (PublicAnswer & { kind: 'skipped' | 'too_large' | 'timeout' | 'error' });

/**
 * GET `url` through the SDK's guard. Throws `SsrfRejection` for a URL (or a
 * redirect) that is not a public http(s) address — or not https, with
 * `requireHttps` — and the request's own error when it could not be made.
 */
export async function readPublicUrl(url: string, options: PublicReadOptions): Promise<PublicRead> {
  const deadline = Date.now() + options.timeoutMs;
  const { response, status, headers, finalUrl } = await safeFetch(url, {
    headers: options.headers,
    headersTimeoutMs: options.timeoutMs,
    requireHttps: options.requireHttps,
  });
  const answer = { status, headers, finalUrl };
  if (!options.wants(status, String(headers['content-type'] ?? ''))) {
    response.destroy();
    return { ...answer, kind: 'skipped' };
  }
  const read = await readResponseBody(response, {
    maxBytes: options.maxBytes,
    timeoutMs: Math.max(1, deadline - Date.now()),
  });
  return read.kind === 'ok'
    ? { ...answer, kind: 'ok', body: read.body }
    : { ...answer, kind: read.kind };
}
