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
  introspect: vi.fn(),
  audit: vi.fn(async () => {}),
  execute: vi.fn(),
};

vi.mock('../capability-authority.js', () => ({
  verifyNotesCapabilityTicket: authority.verify,
  introspectNotesCapabilityTicket: authority.introspect,
  auditNotesCapabilityTicket: authority.audit,
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
  authority.introspect.mockReset();
  authority.audit.mockClear();
  authority.execute.mockReset();
});

describe('/_oxy/capabilities', () => {
  it('refuses a call without a ticket', async () => {
    const res = await call('/readNote?noteId=x');
    expect(res.status).toBe(401);
    expect(authority.execute).not.toHaveBeenCalled();
  });

  it('runs the tool for the ticket’s account, and audits the success', async () => {
    authority.verify.mockResolvedValue(claims());
    authority.introspect.mockResolvedValue(true);
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
    authority.verify.mockResolvedValue(claims());
    authority.introspect.mockResolvedValue(false);
    const res = await call(`/readNote?noteId=${claims().resource.resourceId}`, {
      headers: withTicket,
    });
    expect(res.status).toBe(403);
    expect(authority.execute).not.toHaveBeenCalled();
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
