import { readFileSync } from 'node:fs';
import { NILO_FILE_ENTITY_TYPE } from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { DATABASE_TRIGGERS } from '../triggers.js';

describe('database triggers', () => {
  it('are created by the migrations exactly as the test database creates them', () => {
    const migration = readFileSync(
      new URL('../../drizzle/0039_file_references.sql', import.meta.url),
      'utf8',
    );
    for (const statement of DATABASE_TRIGGERS) {
      expect(migration).toContain(`${statement};`);
    }
  });

  it('queue the removal under the entity type the app links files to', () => {
    expect(DATABASE_TRIGGERS.join('\n')).toContain(`'${NILO_FILE_ENTITY_TYPE}', OLD.page_id`);
  });
});
