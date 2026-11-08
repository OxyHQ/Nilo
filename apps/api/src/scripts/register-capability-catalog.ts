/**
 * Register Nilo's capability catalogs (notes, Nilo's workspace, then the agent memories) with Oxy, as Nilo's service.
 *
 * The deploy runs it as a one-shot task with the release image, after the
 * rollout is healthy (`.github/scripts/deploy-ecs.sh`), so the catalog Oxy
 * hands Alia always describes tools the running API serves. Oxy keys a
 * registration by its digest, so registering the same catalog again is a
 * no-op. Exits non-zero on any failure.
 */
import { appCapabilityCatalogSchema } from '@oxy.so/contracts';
import { registerCapabilityCatalog } from '@oxy.so/mcp';
import { MEMORIES_CAPABILITY_CATALOG } from '../capabilities/memories.catalog.js';
import { NILO_CAPABILITY_CATALOG } from '../capabilities/nilo.catalog.js';
import { NOTES_CAPABILITY_CATALOG } from '../capabilities/notes.catalog.js';
import { OXY_API_URL, oxyApiTransport } from '../oxy.js';

async function main(): Promise<void> {
  // Each catalog is its own registration, keyed by its own digest.
  for (const source of [
    NOTES_CAPABILITY_CATALOG,
    NILO_CAPABILITY_CATALOG,
    MEMORIES_CAPABILITY_CATALOG,
  ]) {
    const catalog = appCapabilityCatalogSchema.parse(source);
    const { digest } = await registerCapabilityCatalog(catalog, {
      oxyApiUrl: OXY_API_URL,
      transport: oxyApiTransport,
      timeoutMs: 15_000,
    });
    process.stdout.write(
      `Registered capability catalog ${catalog.appId} ${catalog.version} (${digest})\n`,
    );
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
