/**
 * Nilo's own Oxy service principal, for the capability authority (ticket
 * introspection and audit, catalog registration) and for events to Alia.
 *
 * On ECS the task role is the identity (Oxy ADR 0026): `oxy-nilo-task` is
 * bound to the Nilo application, and `serviceToken()` attests it whenever no
 * key pair is configured. A pair, where one is set (a laptop, CI), still wins;
 * half a pair is no identity at all.
 */
import { canAttestWorkloadIdentity, OxyServer } from '@oxy.so/core/server';

export const OXY_API_URL = (process.env.OXY_API_URL ?? 'https://api.oxy.so').replace(/\/$/, '');

let client: OxyServer | null | undefined;

export function oxyServiceClient(): OxyServer | null {
  if (client !== undefined) return client;
  const key = process.env.OXY_APPLICATION_KEY?.trim();
  const secret = process.env.OXY_APPLICATION_SECRET?.trim();
  if (key && secret) {
    client = new OxyServer({
      baseURL: OXY_API_URL,
      serviceAuth: { apiKey: key, apiSecret: secret },
    });
  } else if (!key && !secret && canAttestWorkloadIdentity()) {
    client = new OxyServer({ baseURL: OXY_API_URL });
  } else {
    client = null;
  }
  return client;
}

export async function oxyServiceToken(): Promise<string> {
  const configured = oxyServiceClient();
  if (!configured) {
    throw new Error('Nilo has no Oxy identity: no task role to attest and no application key pair');
  }
  return configured.serviceToken();
}

export function invalidateOxyServiceToken(): void {
  oxyServiceClient()?.invalidateServiceToken();
}

export function resetOxyServiceClientForTests(): void {
  client = undefined;
}
