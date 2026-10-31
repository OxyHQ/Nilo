import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import { bindApiClient, releaseApiClient } from '@/lib/api/client';
import { useGroupedSections } from '../group-header';
import type { Database, DatabaseView, RowGroup } from '@/lib/types/databases';

jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://nilo.example' },
}));
let mockServices: OxyServices;
const mockRuntime = {
  subscribe: () => () => undefined,
  getAccountSessionRevision: () => 0,
  getAccountSessionIdentity: () => ({
    accountId: mockServices?.session.userId ?? null,
    sessionId: null,
    revision: 0,
  }),
};
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: true,
    user: { id: mockServices?.session.userId },
    oxyServices: mockServices,
  }),
}));
jest.mock('@oxy.so/services/runtime', () => ({ useOxyRuntime: () => mockRuntime }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const database = {
  id: 'db',
  schema: { properties: [{ id: 'stage', type: 'select', name: 'Stage' }] },
} as unknown as Database;
const view = {
  id: 'view',
  databaseId: 'db',
  type: 'table',
  groupBy: { propertyId: 'stage' },
  config: {},
} as unknown as DatabaseView;
const groups: RowGroup[] = [{ key: 'private-group', count: 1 }];
const tokenFor = (userId: string, jti = 'original') =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ userId, jti, exp: 4102444800 })).toString('base64url')}.sig`;
let toggle: () => void;
let groupCollapsed: boolean;
function Screen() {
  const result = useGroupedSections(database, view, [], groups, false, 'groupBy', true);
  const section = result.sections?.[0];
  if (!section) throw new Error('missing section');
  toggle = result.headerProps(section).onToggle;
  groupCollapsed = result.headerProps(section).collapsed;
  return null;
}

it('rejects an editable A callback after A to B to A and keeps current callbacks usable', async () => {
  const request = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ view }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  mockServices = oxy;
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    oxy.session.setAccessToken(tokenFor('ana'));
    bindApiClient(oxy);
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    const oldA = toggle;
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('bo'));
    });
    await act(async () => {
      oldA();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const init = request.mock.calls.find(([, requestInit]) => requestInit?.method === 'PATCH')?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${tokenFor('bo')}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      config: { collapsedGroups: ['private-group'] },
    });
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('ana'));
    });
    await act(async () => {
      oldA();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const patches = request.mock.calls.filter(([, requestInit]) => requestInit?.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(new Headers(patches[1]?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${tokenFor('ana')}`,
    );
  } finally {
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

it('does not dispatch an A edit after Axios waits and the session becomes B', async () => {
  const { default: apiClient } = require('@/lib/api/client') as typeof import('@/lib/api/client');
  const { queryKeys } =
    require('@/lib/hooks/query-keys') as typeof import('@/lib/hooks/query-keys');
  const request = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ view }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  mockServices = oxy;
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let resolveGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const interceptor = apiClient.interceptors.request.use(async (config) => {
    markStarted();
    await gate;
    return config;
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    oxy.session.setAccessToken(tokenFor('ana'));
    bindApiClient(oxy);
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      toggle();
      await started;
    });
    expect(groupCollapsed).toBe(true);
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('bo'));
    });
    expect(groupCollapsed).toBe(false);
    const bState = { database: { id: 'db' }, views: [{ ...view, name: 'B view' }] };
    client.setQueryData(queryKeys.databases.detail('db'), bState);
    await act(async () => {
      resolveGate();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(request).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.databases.detail('db'))).toEqual(bState);
  } finally {
    resolveGate();
    apiClient.interceptors.request.eject(interceptor);
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

it('leaves B cache untouched when A changes during optimistic preflight', async () => {
  const { queryKeys } =
    require('@/lib/hooks/query-keys') as typeof import('@/lib/hooks/query-keys');
  const request = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ view }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  mockServices = oxy;
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  jest.spyOn(client, 'cancelQueries').mockImplementation(async () => {
    markStarted();
    await gate;
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    oxy.session.setAccessToken(tokenFor('ana'));
    bindApiClient(oxy);
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      toggle();
      await started;
    });
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('bo'));
    });
    const bState = { database: { id: 'db' }, views: [{ ...view, name: 'B view' }] };
    client.setQueryData(queryKeys.databases.detail('db'), bState);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(client.getQueryData(queryKeys.databases.detail('db'))).toEqual(bState);
    expect(request).not.toHaveBeenCalled();
  } finally {
    release();
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

it('keeps an editable callback usable after a same-session token rotation', async () => {
  const request = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ view }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  mockServices = oxy;
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    oxy.session.setAccessToken(tokenFor('ana'));
    bindApiClient(oxy);
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    const beforeRefresh = toggle;
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('ana', 'refreshed'));
    });
    await act(async () => {
      beforeRefresh();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(request).toHaveBeenCalledTimes(1);
    const init = request.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${tokenFor('ana', 'refreshed')}`,
    );
  } finally {
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

it('invalidates an old edit when a parent 401 clears its token', async () => {
  const { apiSessionContextVersion } =
    require('@/lib/api/session-context') as typeof import('@/lib/api/session-context');
  const request = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const isParent = String(input).startsWith('https://oxy.example/');
    return new Response(JSON.stringify(isParent ? { error: 'unauthorized' } : { view }), {
      status: isParent ? 401 : 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = request as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  mockServices = oxy;
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    oxy.session.setAccessToken(tokenFor('ana'));
    bindApiClient(oxy);
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    const oldA = toggle;
    const parentEpoch = oxy.http.getSessionEpoch();
    const linkedContext = apiSessionContextVersion();
    let rejected = false;
    await act(async () => {
      await oxy.http.get('/unauthorized', { retry: false }).catch(() => {
        rejected = true;
      });
    });
    expect(rejected).toBe(true);
    expect(oxy.http.getAccessToken()).toBeNull();
    expect(oxy.http.getSessionEpoch()).toBeGreaterThan(parentEpoch);
    expect(apiSessionContextVersion()).toBeGreaterThan(linkedContext);
    const withoutToken = toggle;
    const nullEpoch = oxy.http.getSessionEpoch();
    const nullContext = apiSessionContextVersion();
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('ana'));
    });
    expect(oxy.http.getSessionEpoch()).toBe(nullEpoch);
    expect(apiSessionContextVersion()).toBeGreaterThan(nullContext);
    await act(async () => {
      oldA();
      withoutToken();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      request.mock.calls.filter(([input]) => String(input).startsWith('https://nilo.example/')),
    ).toHaveLength(0);
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      request.mock.calls.filter(([input]) => String(input).startsWith('https://nilo.example/')),
    ).toHaveLength(1);
    await act(async () => {
      oxy.session.clear();
    });
    await act(async () => {
      withoutToken();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      request.mock.calls.filter(([input]) => String(input).startsWith('https://nilo.example/')),
    ).toHaveLength(1);
  } finally {
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
