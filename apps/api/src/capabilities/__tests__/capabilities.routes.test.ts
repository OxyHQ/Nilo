/**
 * `/_oxy/capabilities`: a call runs only with a ticket for exactly that tool,
 * capability and resource, still live at Oxy; every outcome is audited.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CapabilityTicketClaims } from '@oxy.so/contracts';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Runs under vitest and `bun test`, which has no `vi.hoisted` and does not
// hoist `vi.mock`: plain constants, mocks registered before a dynamic import.
const authority = {
  verify: vi.fn(),
  audit: vi.fn(async () => {}),
  execute: vi.fn(),
  executeMemory: vi.fn(),
};

// The verifier is the SDK's (signature + Oxy's live decision); what is tested
// here is what the route does with each of its outcomes.
vi.mock('../capability-authority.js', () => ({
  verifyCapabilityTicket: authority.verify,
  auditCapabilityTicket: authority.audit,
}));
// The lanes' executors reach the database; what is tested here is the route.
vi.mock('../memories.handlers.js', () => ({ executeMemoryTool: authority.executeMemory }));
vi.mock('../nilo.handlers.js', () => ({ executeNiloTool: vi.fn() }));
vi.mock('../tool-input.js', () => ({
  NiloCapabilityError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock('../notes.handlers.js', () => ({
  executeNotesTool: authority.execute,
  NotesCapabilityError: class extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: capabilitiesRouter } = await import('../../routes/capabilities.js');
const { CapabilityTicketDenied } = await import('../capability-refusal.js');
const { CapabilityTicketError } = await import('@oxy.so/core/server');

let server: Server;
let base: string;

function claims(overrides: Partial<CapabilityTicketClaims> = {}): CapabilityTicketClaims {
  return {
    jti: 'ticket-1',
    aud: 'oxy-noted-api',
    tool: 'readNote',
    capabilities: ['notes.read'],
    limits: [],
    resource: {
      appId: 'noted',
      resourceType: 'note',
      resourceId: '0190a0b0-0000-7000-8000-000000000001',
      effectiveAccountId: 'user-1',
    },
    ...overrides,
  } as unknown as CapabilityTicketClaims;
}

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/_oxy/capabilities${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
const withTicket = { authorization: 'Capability ticket-1' };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/_oxy/capabilities', capabilitiesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  authority.verify.mockReset();
  authority.audit.mockClear();
  authority.execute.mockReset();
  authority.executeMemory.mockReset();
});

describe('/_oxy/capabilities', () => {
  it('refuses a call without a ticket', async () => {
    const res = await call('/readNote?noteId=x');
    expect(res.status).toBe(401);
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it('runs the tool for the ticket’s account, and audits the success', async () => {
    authority.verify.mockResolvedValue(claims());
    authority.execute.mockResolvedValue({ note: { id: 'n' } });
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ note: { id: 'n' } });
    expect(authority.execute).toHaveBeenCalledWith(
      'readNote',
      { noteId: claims().resource.resourceId },
      'user-1',
    );
    expect(authority.audit).toHaveBeenCalledWith(
      expect.objectContaining({ result: { status: 'succeeded' } }),
    );
  });

  it('refuses a ticket for another note, tool or app, and audits the denial', async () => {
    authority.verify.mockResolvedValue(claims());
    const other = await call('/readNote?noteId=0190a0b0-0000-7000-8000-000000000002', {
      headers: withTicket,
    });
    expect(other.status).toBe(403);
    authority.verify.mockResolvedValue(claims({ tool: 'searchNotes' }));
    const tool = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(tool.status).toBe(403);
    expect(authority.execute).not.toHaveBeenCalled();
    expect(authority.audit).toHaveBeenCalledWith(
      expect.objectContaining({ result: { status: 'denied', code: 'capability_scope_mismatch' } }),
    );
  });

  it('refuses a ticket Oxy no longer stands behind', async () => {
    authority.verify.mockRejectedValue(new CapabilityTicketDenied('revoked'));
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'capability_revoked_or_denied' });
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it('refuses a ticket that is not Oxy’s, or not for this catalog', async () => {
    authority.verify.mockRejectedValue(new CapabilityTicketError('invalid_signature', 'forged'));
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_capability_ticket' });
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it('answers 503, never a refusal, when Oxy cannot be asked', async () => {
    authority.verify.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'capability_authority_unavailable' });
    expect(authority.execute).not.toHaveBeenCalled();
    // The next call asks again: nothing about the outage was remembered.
    authority.verify.mockResolvedValue(claims());
    authority.execute.mockResolvedValue({ note: { id: 'n' } });
    const again = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(again.status).toBe(200);
  });

  it('refuses input outside the tool’s schema', async () => {
    authority.verify.mockResolvedValue(claims());
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}&extra=1`, {
      headers: withTicket,
    });
    expect(res.status).toBe(400);
  });
});

describe('an unexpected failure', () => {
  it('is answered 500 rather than left hanging', async () => {
    authority.verify.mockResolvedValue(claims({ limits: 5 } as never));
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'capability_execution_failed' });
  });
});

describe('/_oxy/capabilities: the memories lane', () => {
  const memoryClaims = (overrides: Partial<CapabilityTicketClaims> = {}) =>
    claims({
      aud: 'oxy-nilo-api',
      tool: 'recallMemories',
      capabilities: ['memories.read'],
      resource: {
        appId: 'nilo-memories',
        resourceType: 'nilo_account',
        resourceId: 'user-1',
        effectiveAccountId: 'user-1',
      },
      ...overrides,
    });
  const recall = (body: unknown = { query: 'coffee' }) =>
    call('/recallMemories', {
      method: 'POST',
      headers: withTicket,
      body: JSON.stringify(body),
    });

  it('runs a memory tool for the ticket’s account and audits the success', async () => {
    authority.verify.mockResolvedValue(memoryClaims());
    authority.executeMemory.mockResolvedValue({ memories: [] });
    const res = await recall();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memories: [] });
    expect(authority.executeMemory).toHaveBeenCalledWith(
      'recallMemories',
      { query: 'coffee' },
      'user-1',
    );
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it('refuses a ticket of another app, another account or another capability', async () => {
    authority.verify.mockResolvedValue(
      memoryClaims({
        resource: {
          appId: 'noted',
          resourceType: 'nilo_account',
          resourceId: 'user-1',
          effectiveAccountId: 'user-1',
        },
      }),
    );
    expect((await recall()).status).toBe(403);
    authority.verify.mockResolvedValue(
      memoryClaims({
        resource: {
          appId: 'nilo-memories',
          resourceType: 'nilo_account',
          resourceId: 'user-2',
          effectiveAccountId: 'user-1',
        },
      }),
    );
    expect((await recall()).status).toBe(403);
    authority.verify.mockResolvedValue(memoryClaims({ capabilities: ['pages.read'] }));
    expect((await recall()).status).toBe(403);
    expect(authority.executeMemory).not.toHaveBeenCalled();
  });

  it('ties a memory-scoped ticket to the memory it names', async () => {
    const memoryId = '0190a0b0-0000-7000-8000-0000000000aa';
    const ticket = memoryClaims({
      tool: 'updateMemory',
      capabilities: ['memories.write'],
      resource: {
        appId: 'nilo-memories',
        resourceType: 'memory',
        resourceId: memoryId,
        effectiveAccountId: 'user-1',
      },
    });
    authority.verify.mockResolvedValue(ticket);
    authority.executeMemory.mockResolvedValue({ memory: {} });
    const send = (id: string) =>
      call('/updateMemory', {
        method: 'PATCH',
        headers: withTicket,
        body: JSON.stringify({ idempotencyKey: 'k', memoryId: id, title: 'T' }),
      });
    expect((await send('0190a0b0-0000-7000-8000-0000000000bb')).status).toBe(403);
    expect((await send(memoryId)).status).toBe(200);
  });
});
