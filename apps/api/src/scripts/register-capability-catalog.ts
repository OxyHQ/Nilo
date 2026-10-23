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
import { registerCapabilityCatalog } from '@oxy.so/mcp';
import { NOTES_CAPABILITY_CATALOG } from '../capabilities/notes.catalog.js';
import { OXY_API_URL, oxyServiceTransport } from '../capabilities/oxy-service.js';

async function main(): Promise<void> {
  const catalog = appCapabilityCatalogSchema.parse(NOTES_CAPABILITY_CATALOG);
  const { digest } = await registerCapabilityCatalog(catalog, {
    oxyApiUrl: OXY_API_URL,
    transport: oxyServiceTransport(),
    timeoutMs: 15_000,
  });
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
