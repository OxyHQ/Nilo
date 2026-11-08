import { describe, expect, it } from 'vitest';
import { MEMORIES_CAPABILITY_CATALOG } from '../memories.catalog.js';
import { NILO_CAPABILITY_CATALOG } from '../nilo.catalog.js';
import { NOTES_CAPABILITY_CATALOG } from '../notes.catalog.js';

describe('Memories capability catalog', () => {
  const tools = MEMORIES_CAPABILITY_CATALOG.tools;

  it('is its own app on its own MCP host, apart from the workspace and from Noted', () => {
    expect(MEMORIES_CAPABILITY_CATALOG.appId).toBe('nilo-memories');
    expect(MEMORIES_CAPABILITY_CATALOG.externalMcp?.resource).toBe('https://mcp.memory.nilo.so');
    const hosts = [
      NILO_CAPABILITY_CATALOG,
      NOTES_CAPABILITY_CATALOG,
      MEMORIES_CAPABILITY_CATALOG,
    ].map((catalog) => catalog.externalMcp?.resource);
    expect(new Set(hosts).size).toBe(3);
  });

  it('serves the four memory tools under memory scopes only', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'forgetMemory',
      'recallMemories',
      'remember',
      'updateMemory',
    ]);
    for (const tool of tools) {
      expect(tool.requiredCapabilities).toEqual([
        tool.effect === 'read' ? 'memories.read' : 'memories.write',
      ]);
      // The internal capability route serves only the notes catalog.
      expect(tool.exposure).toEqual(['mcp']);
    }
  });

  it('makes every memory write retry-safe', () => {
    for (const tool of tools.filter((t) => t.effect === 'write')) {
      expect(tool.idempotency).toBe('required');
      expect(tool.inputSchema.required).toContain('idempotencyKey');
    }
  });

  it('shares no tool name with the workspace catalog', () => {
    const pages = new Set(NILO_CAPABILITY_CATALOG.tools.map((tool) => tool.name));
    expect(tools.filter((tool) => pages.has(tool.name))).toEqual([]);
  });
});
