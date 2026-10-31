import type { LinkedHttpClient, OxyServices } from '@oxy.so/core';
import axios from 'axios';
import config from '../config';
import { advanceApiSessionContext, apiSessionContextVersion } from './session-context';
export { onApiSessionContextChange } from './session-context';

let owner: OxyServices | undefined;
let linked: LinkedHttpClient | undefined;
let unsubscribe: (() => void) | undefined;
function fetchLinked(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!linked) throw new Error('The Oxy provider has not bound the product API');
  if (typeof FormData !== 'undefined' && init?.body instanceof FormData) {
    // Fetch owns multipart boundaries, including React Native URI parts.
    const headers = new Headers(init.headers);
    headers.delete('content-type');
    return linked.fetchOptional(input, { ...init, headers });
  }
  return linked.fetchOptional(input, init);
}

/** Keep Axios response/error conventions; Oxy owns session, refresh and origin fencing. */
const apiClient = axios.create({
  baseURL: config.apiUrl,
  timeout: 10000,
  adapter: 'fetch',
  xsrfCookieName: '',
  withXSRFToken: false,
  withCredentials: false,
  env: {
    // @ts-expect-error Axios supports null to disable Request construction; its declaration omits null. Preserve replayable JSON for Oxy's shared transport.
    Request: null,
    fetch: fetchLinked,
  },
});

/** Called during provider render so children cannot dispatch before binding. */
export function bindApiClient(oxy: OxyServices): void {
  if (owner === oxy) return;
  unsubscribe?.();
  linked?.dispose();
  owner = oxy;
  linked = oxy.createLinkedClient({ baseURL: config.apiUrl });
  let epoch = linked.client.getSessionEpoch();
  let hasToken = Boolean(linked.client.getAccessToken());
  unsubscribe = linked.client.addTokenChangeListener((token) => {
    const next = linked?.client.getSessionEpoch();
    const nextHasToken = Boolean(token);
    if (next === epoch && nextHasToken === hasToken) return;
    epoch = next ?? epoch;
    hasToken = nextHasToken;
    advanceApiSessionContext();
  });
  advanceApiSessionContext();
}

/** Dispose only this provider's binding, without disturbing a newer provider. */
export function releaseApiClient(oxy: OxyServices): void {
  if (owner !== oxy) return;
  unsubscribe?.();
  linked?.dispose();
  unsubscribe = undefined;
  linked = undefined;
  owner = undefined;
  advanceApiSessionContext();
}

/** Whether this exact services instance owns the currently bound transport. */
export function ownsApiTransport(oxy: OxyServices): boolean {
  return owner === oxy && linked !== undefined;
}

/** Send only if the session which owned the action still owns the transport. */
export function patchForApiSession<T>(
  url: string,
  data: unknown,
  expected: number,
  owns?: () => boolean,
) {
  return apiClient.patch<T>(url, data, {
    env: {
      fetch: (input, init) => {
        if (apiSessionContextVersion() !== expected || (owns && !owns()))
          throw new Error('The request session changed');
        return fetchLinked(input, init);
      },
    },
  });
}

/** Socket handshakes read the same bound session; HTTP never copies its bearer. */
export function socketAccessToken(signal: AbortSignal): Promise<string> {
  if (!linked) return Promise.reject(new Error('The Oxy provider has not bound the product API'));
  return linked.getAccessToken(config.apiUrl, { signal });
}
export function hasApiSession(): boolean {
  return Boolean(owner?.session.userId);
}
export default apiClient;
