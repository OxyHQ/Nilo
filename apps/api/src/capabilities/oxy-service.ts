/** Nilo authenticates its own workload with temporary IAM credentials, including local SSO. */
import { OxyServer } from '@oxy.so/core/server';
import { createAwsWorkloadCredentialProvider } from '@oxy.so/core/server/aws';

export const OXY_API_URL = (process.env.OXY_API_URL ?? 'https://api.oxy.so').replace(/\/$/, '');
let client: OxyServer | undefined;
let transport: ReturnType<OxyServer['createServiceClient']> | undefined;

export function oxyServiceClient(): OxyServer {
  client ??= new OxyServer({
    baseURL: OXY_API_URL,
    workloadCredentials: createAwsWorkloadCredentialProvider(),
  });
  return client;
}
export function oxyServiceTransport(): ReturnType<OxyServer['createServiceClient']> {
  transport ??= oxyServiceClient().createServiceClient({
    baseURL: OXY_API_URL,
    audience: 'oxy-api',
  });
  return transport;
}
export function resetOxyServiceClientForTests(): void {
  transport?.dispose();
  client?.dispose();
  transport = undefined;
  client = undefined;
}
