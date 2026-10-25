import { createEcosystemTraffic } from '@oxy.so/core/server';
import type { RequestHandler } from 'express';
import { createAwsWorkloadCredentialProvider } from '@oxy.so/core/server/aws';

let activity: ReturnType<typeof createEcosystemTraffic> | undefined;

/** Start at process bootstrap; the shared transport resolves workload credentials lazily. */
export function startEcosystemActivity(ready: () => boolean): void {
  if (activity) return;
  // Optional telemetry cannot report a location on an unconfigured local host.
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) return;
  activity = createEcosystemTraffic({
    service: 'nilo',
    region,
    baseURL: process.env.OXY_API_URL ?? 'https://api.oxy.so',
    workloadCredentials: createAwsWorkloadCredentialProvider(),
    ready,
  });
  activity.installFetch();
}

export const ecosystemActivityMiddleware: RequestHandler = (request, response, next) => {
  if (activity) activity.observeHttp(request, response, next);
  else next();
};

export function observeEcosystemSocket(
  socket: Parameters<ReturnType<typeof createEcosystemTraffic>['observeSocket']>[0],
): void {
  activity?.observeSocket(socket);
}

export async function stopEcosystemActivity(): Promise<void> {
  const current = activity;
  activity = undefined;
  await current?.stop();
}
