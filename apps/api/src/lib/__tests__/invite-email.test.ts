import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Runs under vitest AND `bun test` (see `ecosystemActivity.test.ts`): the mocks
 * are plain constants registered before a dynamic import of the module.
 */
const client = {
  serviceToken: vi.fn(async () => 'service-token'),
  invalidateServiceToken: vi.fn(),
};
let identity: typeof client | null = client;
vi.mock('../../capabilities/oxy-service.js', () => ({
  OXY_API_URL: 'https://oxy.test',
  oxyServiceClient: () => identity,
}));
const warn = vi.fn();
vi.mock('../logger.js', () => ({
  log: { general: { info: vi.fn(), warn, error: vi.fn() } },
}));

let sendInviteEmail: typeof import('../invite-email.js').sendInviteEmail;
let inviteEmailIdempotencyKey: typeof import('../invite-email.js').inviteEmailIdempotencyKey;

beforeAll(async () => {
  ({ sendInviteEmail, inviteEmailIdempotencyKey } = await import('../invite-email.js'));
});

const invite = {
  id: '01a156f0-2a14-7359-9418-b789db925855',
  workspaceId: 'ws-1',
  email: 'guest@example.org',
  role: 'editor' as const,
  invitedBy: 'oxy-user-1',
  createdAt: new Date('2026-10-20T10:00:00.000Z'),
  expiresAt: new Date('2026-11-19T10:00:00.000Z'),
  acceptedAt: null,
  token: 'abcdefghijklmnopqrstuvwxyz012345',
};

const originalFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit }[] = [];
let answers: (Response | Error)[] = [];
let previousEnabled: string | undefined;
let previousPublicUrl: string | undefined;

beforeEach(() => {
  previousEnabled = process.env.INVITE_EMAILS_ENABLED;
  previousPublicUrl = process.env.OXYNILO_PUBLIC_URL;
  process.env.INVITE_EMAILS_ENABLED = 'true';
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
  identity = client;
  calls.length = 0;
  answers = [new Response('{}', { status: 202 })];
  client.serviceToken.mockClear();
  client.invalidateServiceToken.mockClear();
  warn.mockClear();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift() ?? new Response('{}', { status: 202 });
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousEnabled === undefined) delete process.env.INVITE_EMAILS_ENABLED;
  else process.env.INVITE_EMAILS_ENABLED = previousEnabled;
  if (previousPublicUrl === undefined) delete process.env.OXYNILO_PUBLIC_URL;
  else process.env.OXYNILO_PUBLIC_URL = previousPublicUrl;
});

describe('the invitation email', () => {
  it('asks Oxy to send it as Nilo, keyed on the invitation and its issue', async () => {
    const outcome = await sendInviteEmail({
      invite,
      workspaceName: '  Product\n team ',
      locale: 'es-ES',
    });

    expect(outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oxy.test/apps/invitations/email');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer service-token');
    expect(headers['idempotency-key']).toBe(`${invite.id}.${invite.createdAt.getTime()}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      to: 'guest@example.org',
      inviterUserId: 'oxy-user-1',
      resourceName: 'Product team',
      acceptUrl: `https://nilo.example.test/invite/${invite.token}`,
      locale: 'es-ES',
    });
  });

  it('is a new email when the invitation is renewed', () => {
    const renewed = { ...invite, createdAt: new Date('2026-10-21T10:00:00.000Z') };
    expect(inviteEmailIdempotencyKey(renewed)).not.toBe(inviteEmailIdempotencyKey(invite));
    expect(inviteEmailIdempotencyKey(invite)).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  });

  it('cuts a long workspace name to what the subject line takes', async () => {
    await sendInviteEmail({ invite, workspaceName: 'x'.repeat(250), locale: undefined });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.resourceName).toHaveLength(100);
    expect(body.locale).toBeUndefined();
  });

  it('is not attempted unless INVITE_EMAILS_ENABLED is true', async () => {
    delete process.env.INVITE_EMAILS_ENABLED;
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe(
      'disabled',
    );
    process.env.INVITE_EMAILS_ENABLED = '1';
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe(
      'disabled',
    );
    expect(calls).toHaveLength(0);
  });

  it('renews a stale service token once', async () => {
    answers = [new Response('{}', { status: 401 }), new Response('{}', { status: 202 })];
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe('sent');
    expect(client.invalidateServiceToken).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('reports a refusal as failed, and logs why, without throwing', async () => {
    answers = [
      new Response(
        JSON.stringify({ error: 'VALIDATION_ERROR', details: { reason: 'recipient_suppressed' } }),
        { status: 422 },
      ),
    ];
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe('failed');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 422, reason: 'recipient_suppressed' }),
      'Oxy refused the invitation email',
    );
  });

  it('reports an unreachable Oxy as failed', async () => {
    answers = [new Error('connect ECONNREFUSED')];
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe('failed');
  });

  it('reports no Oxy identity, or no link, as failed without calling Oxy', async () => {
    identity = null;
    expect(await sendInviteEmail({ invite, workspaceName: 'W', locale: undefined })).toBe('failed');
    identity = client;
    expect(
      await sendInviteEmail({
        invite: { ...invite, token: null },
        workspaceName: 'W',
        locale: undefined,
      }),
    ).toBe('failed');
    expect(calls).toHaveLength(0);
  });
});
