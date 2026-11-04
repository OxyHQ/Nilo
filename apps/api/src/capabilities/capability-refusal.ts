/**
 * Which way a capability ticket failed, so `/_oxy/capabilities` answers each
 * the one right way and an outage is never read as a refusal.
 */
import { CapabilityTicketError } from '@oxy.so/core/server';

/** Oxy answered, and does not stand behind this ticket (revoked, or a policy no). */
export class CapabilityTicketDenied extends Error {}

/** How a ticket that does not verify is answered. */
export type CapabilityRefusal = 'invalid' | 'denied' | 'unavailable';

/**
 * A ticket that is not Oxy's, not for this catalog or past its time is
 * `invalid` (401); one Oxy no longer stands behind is `denied` (403); anything
 * else — Oxy unreachable, a timeout, an answer that does not parse or whose
 * claims are not the signed ones — is `unavailable` (503), never a refusal.
 */
export function capabilityRefusal(error: unknown): CapabilityRefusal {
  if (error instanceof CapabilityTicketError) return 'invalid';
  if (error instanceof CapabilityTicketDenied) return 'denied';
  return 'unavailable';
}
