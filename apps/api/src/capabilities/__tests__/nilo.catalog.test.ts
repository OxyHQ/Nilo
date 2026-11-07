import { describe, expect, it } from 'vitest';
import { NILO_CAPABILITY_CATALOG } from '../nilo.catalog.js';

describe('Nilo capability catalog', () => {
  const tools = NILO_CAPABILITY_CATALOG.tools;

  it("serves its own MCP resource and namespace, not Noted's", () => {
    expect(NILO_CAPABILITY_CATALOG.appId).toBe('nilo');
    expect(NILO_CAPABILITY_CATALOG.externalMcp?.resource).toBe('https://mcp.nilo.so');
    expect(NILO_CAPABILITY_CATALOG.externalMcp?.resource).not.toContain('noted');
  });

  it('exposes only read tools over MCP in this version', () => {
    const mcp = tools.filter((tool) => tool.exposure.includes('mcp'));
    expect(mcp.map((tool) => tool.name).sort()).toEqual(['listPages', 'readPage', 'searchPages']);
    for (const tool of mcp) {
      expect(tool.effect).toBe('read');
      expect(tool.requiredCapabilities).toEqual(['pages.read']);
    }
  });
});
