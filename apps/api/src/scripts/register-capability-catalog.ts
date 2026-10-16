/**
 * Register the notes capability catalog with Oxy, as Nilo's service.
 *
 * The deploy runs it as a one-shot task with the release image, after the
 * rollout is healthy (`.github/scripts/deploy-ecs.sh`), so the catalog Oxy
 * hands Alia always describes tools the running API serves. Oxy keys a
 * registration by its digest, so registering the same catalog again is a
 * no-op. Exits non-zero on any failure.
 */
import { appCapabilityCatalogSchema } from '@oxy.so/contracts';
import { NOTES_CAPABILITY_CATALOG } from '../capabilities/notes.catalog.js';
import { OXY_API_URL, oxyServiceToken } from '../capabilities/oxy-service.js';

async function main(): Promise<void> {
  const catalog = appCapabilityCatalogSchema.parse(NOTES_CAPABILITY_CATALOG);
  const response = await fetch(`${OXY_API_URL}/capabilities/catalogs/register`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await oxyServiceToken()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ catalog, deployedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Catalog registration failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const body = (await response.json()) as { registration?: { digest?: string } };
  const digest = body.registration?.digest;
  if (typeof digest !== 'string' || digest.length === 0) {
    throw new Error('Catalog registration returned no digest');
  }
  process.stdout.write(
    `Registered capability catalog ${catalog.appId} ${catalog.version} (${digest})\n`,
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
