/**
 * Oxy's capability authority, as the notes catalog's resource server sees it:
 * a ticket is verified against Oxy's published keys AND re-authorised live
 * (introspection, whose claims must be the signed ones exactly) before
 * anything runs, and every outcome is audited. The SDK does both halves
 * (`createLiveCapabilityTicketVerifier`, `createOxyJwksKeyResolver`); this
 * module only binds them to Nilo's catalog (`capability-refusal.ts` says
 * which way a call failed).
 */
import type { auditResultSchema } from '@oxy.so/contracts';
import { createLiveCapabilityTicketVerifier, createOxyJwksKeyResolver } from '@oxy.so/core/server';
import { postOxyServiceJson } from '@oxy.so/mcp';

import { OXY_API_URL, oxy, oxyApiTransport } from '../oxy.js';
import { CapabilityTicketDenied } from './capability-refusal.js';
import { NOTES_CAPABILITY_CATALOG } from './notes.catalog.js';

type AuditResult = ReturnType<typeof auditResultSchema.parse>;

/**
 * The claims of a ticket Oxy signed for this catalog and still stands behind.
 * Throws; `capabilityRefusal` says how to answer what it threw.
 */
export const verifyNotesCapabilityTicket = createLiveCapabilityTicketVerifier({
  issuer: OXY_API_URL,
  audience: NOTES_CAPABILITY_CATALOG.audience,
  resolvePublicKey: createOxyJwksKeyResolver({
    jwksUrl: `${OXY_API_URL}/capabilities/.well-known/jwks.json`,
  }),
  introspect: async (ticket, { signal }) => {
    const answer = await oxy.agency.introspectCapabilityTicket(ticket, { signal });
    if (answer.active !== true || answer.decision?.allowed !== true) {
      throw new CapabilityTicketDenied('Capability ticket is not live at Oxy');
    }
    return answer;
  },
});

export async function auditNotesCapabilityTicket(input: {
  ticket: string;
  result: AuditResult;
  rollbackSupported: boolean;
  idempotencyKeyHash?: string;
}): Promise<void> {
  await postOxyServiceJson(
    {
      ticket: input.ticket,
      result: input.result,
      rollback: { supported: input.rollbackSupported, attempted: false },
      ...(input.idempotencyKeyHash ? { idempotencyKeyHash: input.idempotencyKeyHash } : {}),
    },
    { endpoint: `${OXY_API_URL}/capabilities/audit`, transport: oxyApiTransport },
  );
}
