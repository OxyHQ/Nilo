import { appCapabilityCatalogSchema } from '@oxy.so/contracts';
import { createCatalogMcpToolDefinitions, type CatalogToolHandlers } from '@oxy.so/mcp';
import { describe, expect, it } from 'vitest';

import { NOTES_CAPABILITY_CATALOG } from '../notes.catalog.js';

describe('the notes capability catalog', () => {
  it('is valid and defines every tool exactly once', () => {
    expect(appCapabilityCatalogSchema.parse(NOTES_CAPABILITY_CATALOG)).toEqual(
      NOTES_CAPABILITY_CATALOG,
    );

    const names = NOTES_CAPABILITY_CATALOG.tools.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(NOTES_CAPABILITY_CATALOG.externalMcp).toEqual({
      resource: 'https://mcp.noted.oxy.so',
    });
  });

  it('uses the same names, schemas, capabilities, and versions for MCP', () => {
    const handlers = Object.fromEntries(
      NOTES_CAPABILITY_CATALOG.tools.map(({ name }) => [
        name,
        async () => ({ structuredContent: {} }),
      ]),
    ) as CatalogToolHandlers;

    const definitions = createCatalogMcpToolDefinitions(NOTES_CAPABILITY_CATALOG, handlers);
    const publicTools = NOTES_CAPABILITY_CATALOG.tools.filter(({ exposure }) =>
      exposure.includes('mcp'),
    );

    expect(definitions.map(({ tool }) => tool)).toEqual(publicTools);
  });

  it('requires idempotency keys for every effectful tool', () => {
    for (const tool of NOTES_CAPABILITY_CATALOG.tools) {
      if (tool.effect === 'read') continue;
      expect(tool.idempotency).toBe('required');
      // Read, not matched: under bun, `toMatchObject` with an asymmetric
      // matcher writes the matcher into the object it was given — the shared
      // catalog every later test file imports.
      expect((tool.inputSchema as { required?: string[] }).required).toContain('idempotencyKey');
    }
  });
});

describe('where the catalog is served', () => {
  it('keeps Noted’s identity, so existing grants carry over, and is invoked on Nilo', () => {
    expect(NOTES_CAPABILITY_CATALOG).toMatchObject({
      appId: 'noted',
      audience: 'oxy-noted-api',
      accountResourceType: 'noted_account',
      internalBaseUrl: 'https://api.nilo.so',
    });
    for (const tool of NOTES_CAPABILITY_CATALOG.tools) {
      expect(tool.invocation.path).toBe(`/_oxy/capabilities/${tool.name}`);
    }
  });
});
