import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATABASE_PREREQUISITES } from '../prerequisites.js';

describe('database prerequisites', () => {
  it('are created by the migrations exactly as the test database creates them', () => {
    const directory = new URL('../../drizzle/', import.meta.url);
    const migrations = readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(new URL(name, directory), 'utf8'));
    for (const statement of DATABASE_PREREQUISITES) {
      const created = migrations.some((migration) =>
        migration.includes(`${statement};--> statement-breakpoint`),
      );
      expect(created, statement).toBe(true);
    }
  });
});
