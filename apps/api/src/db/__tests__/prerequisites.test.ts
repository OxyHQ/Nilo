import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATABASE_PREREQUISITES } from '../prerequisites.js';

describe('database prerequisites', () => {
  it('are created by the migrations exactly as the test database creates them', () => {
    const migration = readFileSync(
      new URL('../../drizzle/0018_unaccent_search.sql', import.meta.url),
      'utf8',
    );
    for (const statement of DATABASE_PREREQUISITES) {
      expect(migration).toContain(`${statement};--> statement-breakpoint`);
    }
  });
});
