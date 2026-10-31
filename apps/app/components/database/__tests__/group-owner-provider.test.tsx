import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OxyServices } from '@oxy.so/core';
import type { Database, DatabaseView, RowGroup } from '@/lib/types/databases';

jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://nilo.example' },
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

it('binds editable group actions to the real provider account and session', async () => {
  const path = require('node:path') as typeof import('node:path');
  const clientEntry = require.resolve('@oxy.so/services/ui/client');
  const serviceRoot = clientEntry.replace(/\/lib\/commonjs\/ui\/client\.js$/, '/src/ui/client.ts');
  const serviceDir = path.dirname(serviceRoot);
  const bootPath = path.join(serviceDir, 'boot/runProviderColdBoot');
  const sessionPath = path.join(serviceDir, 'session/index');
  let commit: ((input: unknown, options: unknown) => Promise<void>) | undefined;
  let holdStorage = false;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.doMock(bootPath, () => {
    const actual = jest.requireActual(bootPath);
    return {
      ...actual,
      runProviderColdBoot: (options: { commitSession: typeof commit }) => {
        commit = options.commitSession;
        return actual.runProviderColdBoot(options);
      },
    };
  });
  jest.doMock(sessionPath, () => {
    const actual = jest.requireActual(sessionPath);
    const sessionClient = {
      getState: () => null,
      getDirectory: () => null,
      resetLocalState: jest.fn(),
      refreshDirectory: jest.fn(async () => undefined),
      activateContext: jest.fn(async () => undefined),
      signOutContext: jest.fn(async () => undefined),
      signOutPrincipal: jest.fn(async () => undefined),
      subscribe: () => () => undefined,
      start: jest.fn(async () => undefined),
      bootstrap: jest.fn(async () => undefined),
      adoptState: () => true,
      addCurrentAccount: jest.fn(async () => undefined),
      registerAndActivate: jest.fn(async () => undefined),
      switchAccount: jest.fn(async () => undefined),
      signOut: jest.fn(async () => undefined),
    };
    return {
      ...actual,
      createPlatformAuthStateStore: (...args: unknown[]) => {
        const store = actual.createPlatformAuthStateStore(...args);
        return {
          ...store,
          load: async () => {
            if (holdStorage) await blocked;
            return store.load();
          },
        };
      },
      createSessionClient: () => ({
        client: sessionClient,
        host: {
          setCurrentAccountId: jest.fn(),
          setDeviceCredential: jest.fn(),
          getDeviceCredential: () => null,
        },
      }),
    };
  });
  const { OxyRuntimeProvider, useOxy } = require(path.join(serviceDir, 'context/OxyContext'));
  const { useOxyRuntime } = require(path.join(serviceDir, 'runtime'));
  jest.doMock('@oxy.so/services/ui/client', () => ({ useOxy }));
  const { useGroupedSections } = require('../group-header') as typeof import('../group-header');
  const {
    default: apiClient,
    bindApiClient,
    releaseApiClient,
  } = require('@/lib/api/client') as typeof import('@/lib/api/client');
  const { queryKeys } =
    require('@/lib/hooks/query-keys') as typeof import('@/lib/hooks/query-keys');
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
  const groups: RowGroup[] = [{ key: 'private-group-A', count: 1 }];
  const tokenFor = (userId: string) =>
    `e30.${Buffer.from(JSON.stringify({ userId, exp: 4102444800 })).toString('base64url')}.fixture`;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ view }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const oxy = new OxyServices({ baseURL: 'https://oxy.example' });
  jest
    .spyOn(oxy.users, 'me')
    .mockImplementation(async () => ({ id: oxy.session.userId, username: 'test' }) as never);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  let projected: string | null = null;
  let toggle = () => {};
  let runtime!: {
    setAccount: (user: { id: string; username: string }) => void;
    setActiveSessionId: (id: string | null) => void;
    getSnapshot: () => { activeSessionId: string | null };
    batch: (fn: () => void) => void;
  };
  function Capture() {
    const context = useOxy();
    runtime = useOxyRuntime();
    projected = context.user?.id ?? null;
    const bound = useRef<unknown>(null);
    if (bound.current !== context.oxyServices) {
      bound.current = context.oxyServices;
      bindApiClient(context.oxyServices);
    }
    const result = useGroupedSections(database, view, [], groups, false, 'groupBy', true);
    const section = result.sections?.[0];
    if (section) toggle = result.headerProps(section).onToggle;
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <OxyRuntimeProvider oxyServices={oxy} baseURL="https://oxy.example" clientId="nilo-test">
            <Capture />
          </OxyRuntimeProvider>
        </QueryClientProvider>,
      );
    });
    if (!commit) throw new Error(`provider cold boot commit unavailable (${serviceRoot})`);
    const commitSession = commit;
    await act(async () => {
      await commitSession(
        {
          sessionId: 'a-session',
          userId: 'ana',
          accessToken: tokenFor('ana'),
          user: { id: 'ana', username: 'ana' },
        },
        { activate: true },
      );
    });
    expect(projected).toBe('ana');
    const subOnly = `e30.${Buffer.from(JSON.stringify({ sub: 'ana', exp: 4102444800 })).toString('base64url')}.fixture`;
    for (const token of ['opaque-token', subOnly]) {
      await act(async () => {
        oxy.session.setAccessToken(token);
      });
      await act(async () => {
        toggle();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(
        requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
      ).toHaveLength(0);
    }
    await act(async () => {
      oxy.session.setAccessToken(tokenFor('ana'));
    });
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(1);
    requests.length = 0;
    const other = new OxyServices({ baseURL: 'https://oxy.example' });
    other.session.setAccessToken(tokenFor('bo'));
    await act(async () => {
      bindApiClient(other);
    });
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    await act(async () => {
      bindApiClient(oxy);
    });
    other.dispose();
    let resume!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const interceptor = apiClient.interceptors.request.use(async (config) => {
      started();
      await waiting;
      return config;
    });
    try {
      await act(async () => {
        toggle();
        await entered;
      });
      await act(async () => {
        runtime.batch(() => {
          runtime.setAccount({ id: 'bo', username: 'bo' });
          runtime.setAccount({ id: 'ana', username: 'ana' });
        });
      });
      const nextCache = { database: { id: 'db' }, views: [{ ...view, name: 'new account data' }] };
      client.setQueryData(queryKeys.databases.detail('db'), nextCache);
      await act(async () => {
        resume();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(
        requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
      ).toHaveLength(0);
      expect(client.getQueryData(queryKeys.databases.detail('db'))).toEqual(nextCache);
    } finally {
      resume();
      apiClient.interceptors.request.eject(interceptor);
    }
    // The guard observes projected sessions; it cannot prove that the bearer
    // belongs to the newly projected session of the same account.
    const originalSession = runtime.getSnapshot().activeSessionId;
    await act(async () => {
      runtime.setActiveSessionId('other-session');
    });
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(1);
    requests.length = 0;
    await act(async () => {
      runtime.setActiveSessionId(originalSession);
    });
    let oldA = toggle;
    await act(async () => {
      runtime.setActiveSessionId('other-session');
      runtime.setActiveSessionId(originalSession);
    });
    await act(async () => {
      oldA();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    oldA = toggle;
    await act(async () => {
      runtime.batch(() => {
        runtime.setAccount({ id: 'bo', username: 'bo' });
        oldA();
        runtime.setAccount({ id: 'ana', username: 'ana' });
        oldA();
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    oldA = toggle;
    await act(async () => {
      runtime.setAccount({ id: 'bo', username: 'bo' });
      runtime.setAccount({ id: 'ana', username: 'ana' });
    });
    expect(projected).toBe('ana');
    await act(async () => {
      oldA();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    await act(async () => {
      runtime.setAccount({ id: 'bo', username: 'bo' });
    });
    expect(projected).toBe('bo');
    expect(oxy.session.userId).toBe('ana');
    await act(async () => {
      oldA();
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    await act(async () => {
      runtime.setAccount({ id: 'ana', username: 'ana' });
    });
    expect(projected).toBe('ana');
    await act(async () => {
      oldA();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(0);
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(
      requests.filter((entry) => entry.url === 'https://nilo.example/databases/db/views/view'),
    ).toHaveLength(1);
    requests.length = 0;
    holdStorage = true;
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = commitSession(
        {
          sessionId: 'b-session',
          userId: 'bo',
          accessToken: tokenFor('bo'),
          user: { id: 'bo', username: 'bo' },
          deviceId: 'device',
          deviceSecret: 'secret',
        },
        { activate: true },
      );
      await Promise.resolve();
    });
    expect(projected).toBe('ana');
    expect(oxy.session.userId).toBe('bo');
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const patch = requests.find(
      (entry) =>
        entry.url === 'https://nilo.example/databases/db/views/view' &&
        entry.init?.method === 'PATCH',
    );
    expect(patch).toBeUndefined();
    release();
    await act(async () => {
      await pending;
    });
    expect(projected).toBe('bo');
    await act(async () => {
      toggle();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const current = requests.find(
      (entry) =>
        entry.url === 'https://nilo.example/databases/db/views/view' &&
        entry.init?.method === 'PATCH',
    );
    expect(new Headers(current?.init?.headers).get('authorization')).toBe(
      `Bearer ${tokenFor('bo')}`,
    );
  } finally {
    release();
    if (renderer) act(() => renderer?.unmount());
    releaseApiClient(oxy);
    oxy.dispose();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
