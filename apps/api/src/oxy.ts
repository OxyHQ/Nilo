/**
 * The one `OxyServer` of this process (`@oxy.so/core` docs/backend.mdx): every
 * call Nilo makes to Oxy, every session it validates and every socket it
 * admits goes through it. Nothing else constructs one.
 *
 * - Workload identity: Nilo authenticates as itself with temporary IAM
 *   credentials (the ECS task role, or a local SSO profile), never a key.
 * - `serviceIdentity: 'when-anonymous'`: reads with no person behind them
 *   (profiles, files) carry Nilo's service token instead of going out
 *   anonymous, which Oxy charges to the shared NAT address.
 * - `applicationId`: Nilo's Oxy application, the one its files are linked to.
 */
import { OxyServer } from '@oxy.so/core/server';
import { createAwsWorkloadCredentialProvider } from '@oxy.so/core/server/aws';
import { NILO_OXY_APPLICATION_ID } from '@oxy.so/nilo-contracts';

export const OXY_API_URL = (process.env.OXY_API_URL ?? 'https://api.oxy.so').replace(/\/$/, '');

export const oxy = new OxyServer({
  baseURL: OXY_API_URL,
  applicationId: NILO_OXY_APPLICATION_ID,
  serviceIdentity: 'when-anonymous',
  workloadCredentials: createAwsWorkloadCredentialProvider(),
});

/**
 * Oxy's API as a service-authenticated `fetch`, for the `@oxy.so/mcp` helpers
 * and the routes Oxy's SDK has no method for (`/capabilities/audit`,
 * `/apps/invitations/email`). It shares `oxy`'s workload identity.
 */
export const oxyApiTransport = oxy.createServiceClient({
  baseURL: OXY_API_URL,
  audience: 'oxy-api',
});
