import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ALIA_SERVICE_AUDIENCE } from '@alia.onl/server';
import { normalizedAppEventSchema } from '@oxy.so/contracts';

// Run in a separate Bun process: other runtime tests deliberately mock OxyServer.
// Credentials are local test values; the issuer fixture never contacts AWS.
process.env.AWS_ACCESS_KEY_ID = 'ASIA_TEST';
process.env.AWS_SECRET_ACCESS_KEY = 'fixture';
process.env.AWS_SESSION_TOKEN = 'fixture';
process.env.AWS_CREDENTIAL_EXPIRATION = new Date(Date.now() + 3_600_000).toISOString();
process.env.AWS_REGION = 'us-east-1';
const minted: { audience: string; protocolVersion: number }[] = [];
const deliveries: { path: string; key: string; body: unknown; audience: string }[] = [];
let refuseAlia = true;
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  res.setHeader('content-type', 'application/json');
  if (req.url?.endsWith('/challenge')) return res.end('{"nonce":"fixture"}');
  if (req.url?.endsWith('/workload')) {
    const exchange = { ...JSON.parse(body) };
    exchange.audience ??= 'oxy-api';
    minted.push(exchange);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      type: 'service',
      authority: 'first_party',
      appId: 'nilo',
      credentialId: 'wl_nilo',
      ownerAccountId: 'owner',
      environment: 'development',
      iss: 'oxy-auth',
      iat: now,
      exp: now + 300,
      aud: exchange.audience,
      nonce: minted.length,
    };
    const token = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
    return res.end(JSON.stringify({ token, expiresIn: 300 }));
  }
  const payload = req.headers.authorization?.slice(7).split('.')[1];
  assert.ok(payload);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  deliveries.push({
    path: req.url ?? '',
    key: String(req.headers['idempotency-key']),
    body: JSON.parse(body),
    audience: claims.aud,
  });
  assert.equal(req.headers.cookie, undefined);
  if (req.url === '/webhooks/oxy' && refuseAlia) {
    refuseAlia = false;
    res.statusCode = 401;
    return res.end('{"error":"expired"}');
  }
  res.statusCode = 202;
  res.end('{}');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const baseURL = `http://127.0.0.1:${address.port}`;
process.env.OXY_API_URL = baseURL;
process.env.ALIA_API_URL = baseURL;
process.env.INVITE_EMAILS_ENABLED = 'true';
process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
const { deliverToAlia } = await import('../../event-outbox.js');
const { sendInviteEmail, inviteEmailIdempotencyKey } = await import('../../../lib/invite-email.js');
const { resetOxyServiceClientForTests } = await import('../../oxy-service.js');
try {
  const event = normalizedAppEventSchema.parse({
    eventId: 'event-1',
    appId: 'nilo',
    accountId: 'account-1',
    resource: {
      appId: 'nilo',
      resourceType: 'note',
      resourceId: 'note-1',
      effectiveAccountId: 'account-1',
    },
    type: 'note.created',
    occurredAt: new Date().toISOString(),
    data: {},
  });
  await deliverToAlia(event);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(
    deliveries.map((entry) => entry.key),
    [event.eventId, event.eventId],
  );
  assert.deepEqual(
    deliveries.map((entry) => entry.body),
    [event, event],
  );
  assert.ok(deliveries.every((entry) => entry.audience === ALIA_SERVICE_AUDIENCE));
  const invite = {
    id: 'invite-1',
    workspaceId: 'workspace-1',
    email: 'guest@example.test',
    role: 'editor' as const,
    invitedBy: 'account-1',
    createdAt: new Date('2026-10-20T10:00:00Z'),
    expiresAt: new Date('2026-11-20T10:00:00Z'),
    acceptedAt: null,
    token: 'fixture-invite-token',
  };
  assert.equal(await sendInviteEmail({ invite, workspaceName: 'Workspace', locale: 'en' }), 'sent');
  assert.equal(deliveries[2]?.path, '/apps/invitations/email');
  assert.equal(deliveries[2]?.key, inviteEmailIdempotencyKey(invite));
  assert.equal(deliveries[2]?.audience, 'oxy-api');
  assert.deepEqual(
    minted.map(({ audience, protocolVersion }) => ({ audience, protocolVersion })),
    [
      { audience: ALIA_SERVICE_AUDIENCE, protocolVersion: 2 },
      { audience: ALIA_SERVICE_AUDIENCE, protocolVersion: 2 },
      { audience: 'oxy-api', protocolVersion: 2 },
    ],
  );
  process.stdout.write('NILO_PRODUCER_TRANSPORT_OK\n');
} finally {
  resetOxyServiceClientForTests();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
