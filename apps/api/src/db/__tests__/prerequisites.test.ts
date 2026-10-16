import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATABASE_PREREQUISITES } from '../prerequisites.js';

describe('database prerequisites', () => {
  it('are created by the migrations exactly as the test database creates them', () => {
    const folder = new URL('../../drizzle/', import.meta.url);
    const migrations = readdirSync(folder)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(new URL(name, folder), 'utf8'))
      .join('\n');
    for (const statement of DATABASE_PREREQUISITES) {
      expect(migrations).toContain(`${statement};--> statement-breakpoint`);
    }
  });
});
