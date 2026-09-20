import { canAttestWorkloadIdentity, createEcosystemTraffic } from '@oxy.so/core/server';
import type { RequestHandler } from 'express';

let activity: ReturnType<typeof createEcosystemTraffic> | undefined;

/**
 * Start only at process bootstrap; constructing a test app starts no publisher.
 *
 * ## Why the key pair is no longer what decides this
 *
 * The gate here asks one question — can this process authenticate to Oxy at
 * all? Until oxy ADR 0026 the only answer was a key pair, so the pair was the
 * gate. It is no longer the only answer: a deployed task signs an STS
 * `GetCallerIdentity` request with its own ECS task role, Oxy replays it, and
 * the same service token comes back with no secret anywhere. Every Oxy service
 * is moving to that, which means `OXY_SERVICE_API_KEY` and
 * `OXY_SERVICE_API_SECRET` are being DELETED from the task definitions.
 *
 * Had this kept gating on the pair, that deletion would have turned nilo's
 * publisher off silently: a healthy service, a green rollout, and nilo simply
 * missing from the ecosystem dashboard with one warning line to explain it. The
 * container credentials endpoint ECS exposes to every task — what
 * `canAttestWorkloadIdentity()` reads — is the honest test of "am I a deployed
 * process that can prove what it is".
 *
 * The pair is still accepted while it is still injected: `createEcosystemTraffic`
 * prefers it and falls back to attestation, so this boots either way during the
 * migration. A laptop has neither, and still starts no publisher.
 */
export function startEcosystemActivity(ready: () => boolean): void {
  const pair =
    Boolean(process.env.OXY_SERVICE_API_KEY?.trim()) && Boolean(process.env.OXY_SERVICE_API_SECRET?.trim());
  if (!pair && !canAttestWorkloadIdentity()) {
    console.warn(
      'Ecosystem activity is disabled for nilo: no OXY_SERVICE_API_KEY/OXY_SERVICE_API_SECRET and no workload identity to attest',
    );
    return;
  }
  if (activity) return;
  activity = createEcosystemTraffic({
    service: 'nilo',
    ready,
  });
  activity.installFetch();
}

export const ecosystemActivityMiddleware: RequestHandler = (request, response, next) => {
  if (activity) activity.observeHttp(request, response, next);
  else next();
};

export function observeEcosystemSocket(socket: Parameters<ReturnType<typeof createEcosystemTraffic>['observeSocket']>[0]): void {
  activity?.observeSocket(socket);
}

export async function stopEcosystemActivity(): Promise<void> {
  const current = activity;
  activity = undefined;
  await current?.stop();
}
