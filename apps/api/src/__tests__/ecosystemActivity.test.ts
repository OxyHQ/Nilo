import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * This file runs under vitest AND under `bun test` (the production runtime; see
 * the `test:bun` script). bun:test has no `vi.hoisted` or `vi.stubEnv`, and its
 * `vi.mock` is not hoisted, so: the mocks are plain constants, the mock is
 * registered before the module under test is imported, and that import is
 * dynamic so it cannot be hoisted above the mock under either runner.
 */
const publisher = {
  observeHttp: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  installFetch: vi.fn(),
  observeSocket: vi.fn(),
  stop: vi.fn(async () => {}),
};
const create = vi.fn((_options: unknown) => publisher);
const credentialProvider = vi.fn(async () => {
  throw new Error('Not resolved during bootstrap');
});
vi.mock('@oxy.so/core/server', () => ({ createEcosystemTraffic: create }));
vi.mock('@oxy.so/core/server/aws', () => ({
  createAwsWorkloadCredentialProvider: () => credentialProvider,
}));

let ecosystemActivityMiddleware: typeof import('../ecosystemActivity').ecosystemActivityMiddleware;
let observeEcosystemSocket: typeof import('../ecosystemActivity').observeEcosystemSocket;
let startEcosystemActivity: typeof import('../ecosystemActivity').startEcosystemActivity;
let stopEcosystemActivity: typeof import('../ecosystemActivity').stopEcosystemActivity;

beforeAll(async () => {
  ({
    ecosystemActivityMiddleware,
    observeEcosystemSocket,
    startEcosystemActivity,
    stopEcosystemActivity,
  } = await import('../ecosystemActivity'));
});

describe('ecosystem activity lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await stopEcosystemActivity();
    vi.restoreAllMocks();
  });

  it('starts with a lazy workload provider without requiring client keys or an ECS-only hint', () => {
    startEcosystemActivity(() => true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'nilo', workloadCredentials: credentialProvider }),
    );
    expect(credentialProvider).not.toHaveBeenCalled();
    expect(publisher.installFetch).toHaveBeenCalledTimes(1);
  });

  it('fails boot when the shared collector rejects its configuration', () => {
    create.mockImplementationOnce(() => {
      throw new Error('Invalid infrastructure region');
    });
    expect(() => startEcosystemActivity(() => true)).toThrow('Invalid infrastructure region');
    expect(publisher.installFetch).not.toHaveBeenCalled();
  });

  it('installs once and supplies live readiness without retaining request bodies', async () => {
    let ready = false;
    startEcosystemActivity(() => ready);
    startEcosystemActivity(() => ready);
    expect(create).toHaveBeenCalledTimes(1);
    expect(publisher.installFetch).toHaveBeenCalledTimes(1);
    const socket = {} as never;
    observeEcosystemSocket(socket);
    expect(publisher.observeSocket).toHaveBeenCalledWith(socket);
    const options = create.mock.calls[0]?.[0] as unknown as { service: string; ready(): boolean };
    expect(options.service).toBe('nilo');
    expect(options.ready()).toBe(false);
    ready = true;
    expect(options.ready()).toBe(true);
    const next = vi.fn();
    ecosystemActivityMiddleware({} as never, {} as never, next);
    expect(publisher.observeHttp).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    await stopEcosystemActivity();
    await stopEcosystemActivity();
    expect(publisher.stop).toHaveBeenCalledTimes(1);
  });
});
