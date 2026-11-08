/**
 * Oxy's capability authority, as the resource server of Nilo's catalogs (notes, pages, memories) sees it:
 * a ticket is verified against Oxy's published keys AND re-authorised live
 * (introspection, whose claims must be the signed ones exactly) before
 * anything runs, and every outcome is audited. The SDK does both halves
 * (`createLiveCapabilityTicketVerifier`, `createOxyJwksKeyResolver`); this
 * module only binds them to each catalog's audience (`capability-refusal.ts` says
 * which way a call failed).
 */
import type { AppCapabilityCatalog, auditResultSchema } from '@oxy.so/contracts';
import { createLiveCapabilityTicketVerifier, createOxyJwksKeyResolver } from '@oxy.so/core/server';
import { postOxyServiceJson } from '@oxy.so/mcp';

import { OXY_API_URL, oxy, oxyApiTransport } from '../oxy.js';
import { CapabilityTicketDenied } from './capability-refusal.js';

type AuditResult = ReturnType<typeof auditResultSchema.parse>;

/** One verifier per audience: the catalogs of one audience (`nilo`, `nilo-memories`) share it. */
const verifiers = new Map<string, ReturnType<typeof createLiveCapabilityTicketVerifier>>();

function verifierFor(audience: string) {
  let verify = verifiers.get(audience);
  if (!verify) {
    verify = createLiveCapabilityTicketVerifier({
      issuer: OXY_API_URL,
      audience,
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
    verifiers.set(audience, verify);
  }
  return verify;
}

/**
 * The claims of a ticket Oxy signed for `catalog` and still stands behind.
 * Throws; `capabilityRefusal` says how to answer what it threw.
 */
export function verifyCapabilityTicket(catalog: AppCapabilityCatalog, ticket: string) {
  return verifierFor(catalog.audience)(ticket);
}

export async function auditCapabilityTicket(input: {
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
