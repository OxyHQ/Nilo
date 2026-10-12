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
const canAttest = vi.fn(() => false);
vi.mock('@oxy.so/core/server', () => ({
  createEcosystemTraffic: create,
  canAttestWorkloadIdentity: canAttest,
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

/** `vi.stubEnv` semantics by hand: `undefined` deletes the variable. */
const STUBBED_ENV = ['OXY_SERVICE_API_KEY', 'OXY_SERVICE_API_SECRET'] as const;
type StubbedEnv = (typeof STUBBED_ENV)[number];
const originalEnv = new Map(STUBBED_ENV.map((name) => [name, process.env[name]]));
function stubEnv(name: StubbedEnv, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
function unstubAllEnvs(): void {
  for (const [name, value] of originalEnv) stubEnv(name, value);
}

describe('ecosystem activity lifecycle', () => {
  beforeEach(() => {
    stubEnv('OXY_SERVICE_API_KEY', 'test-key');
    stubEnv('OXY_SERVICE_API_SECRET', 'test-secret');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.clearAllMocks();
    // A laptop cannot attest; the ECS case is asserted on its own below.
    canAttest.mockReturnValue(false);
  });
  afterEach(async () => {
    await stopEcosystemActivity();
    unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not start or publish when the credential key is missing and nothing can be attested', () => {
    stubEnv('OXY_SERVICE_API_KEY', undefined);
    startEcosystemActivity(() => true);
    expect(create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    const next = vi.fn();
    ecosystemActivityMiddleware({} as never, {} as never, next);
    observeEcosystemSocket({} as never);
    expect(next).toHaveBeenCalledTimes(1);
    expect(publisher.observeSocket).not.toHaveBeenCalled();
  });

  it('does not start or publish when the credential secret is missing and nothing can be attested', () => {
    stubEnv('OXY_SERVICE_API_SECRET', undefined);
    startEcosystemActivity(() => true);
    expect(create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not start when a credential is present but blank', () => {
    stubEnv('OXY_SERVICE_API_KEY', '   ');
    startEcosystemActivity(() => true);
    expect(create).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  /**
   * The case the migration off the key pair turns into the NORMAL one: a task
   * with no credential in its environment, which can still prove what it is.
   * Gating on the pair here would have left nilo silently absent from the
   * dashboard the moment the secret was dropped from its task definition.
   */
  it('starts on an attestable workload with no key pair at all', () => {
    stubEnv('OXY_SERVICE_API_KEY', undefined);
    stubEnv('OXY_SERVICE_API_SECRET', undefined);
    canAttest.mockReturnValue(true);
    startEcosystemActivity(() => true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(publisher.installFetch).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
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
