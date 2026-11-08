import { appCapabilityCatalogSchema } from '@oxy.so/contracts';
import { describe, expect, it } from 'vitest';
import { MEMORIES_CAPABILITY_CATALOG } from '../memories.catalog.js';
import { NILO_CAPABILITY_CATALOG } from '../nilo.catalog.js';
import { NOTES_CAPABILITY_CATALOG } from '../notes.catalog.js';

describe('Nilo capability catalog', () => {
  const tools = NILO_CAPABILITY_CATALOG.tools;

  // The deploy registers the catalog with Oxy, which parses it with this schema:
  // a catalog it rejects fails the release after the rollout.
  it('parses with the schema Oxy registers it under', () => {
    expect(appCapabilityCatalogSchema.safeParse(NILO_CAPABILITY_CATALOG).success).toBe(true);
  });

  it("serves its own MCP resource and namespace, not Noted's", () => {
    expect(NILO_CAPABILITY_CATALOG.appId).toBe('nilo');
    expect(NILO_CAPABILITY_CATALOG.externalMcp?.resource).toBe('https://mcp.nilo.so');
    expect(NILO_CAPABILITY_CATALOG.externalMcp?.resource).not.toContain('noted');
  });

  it('exposes only the read-only page tools, under the pages scope', () => {
    const mcp = tools.filter((tool) => tool.exposure.includes('mcp'));
    expect(mcp.map((tool) => tool.name).sort()).toEqual(['listPages', 'readPage', 'searchPages']);
    for (const tool of mcp) {
      expect(tool.effect).toBe('read');
      expect(tool.requiredCapabilities).toEqual(['pages.read']);
    }
  });

  // Oxy refuses a catalog its own schema rejects at registration, which runs after the
  // rollout (`register-capability-catalog.ts`): a catalog that fails here fails the deploy.
  it.each([
    ['nilo', NILO_CAPABILITY_CATALOG],
    ['nilo-memories', MEMORIES_CAPABILITY_CATALOG],
    ['noted', NOTES_CAPABILITY_CATALOG],
  ])('is a catalog Oxy accepts: %s', (_name, catalog) => {
    const parsed = appCapabilityCatalogSchema.safeParse(catalog);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });
});
