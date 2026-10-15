import { isEntityId } from '@nilo/contracts';
import { isLiveEntityId } from '@oxy.so/db';
import { describe, expect, it } from 'vitest';

/**
 * `@nilo/contracts` restates the database's id rule so the app need not import
 * `@oxy.so/db`; this keeps the two from drifting apart.
 */
describe('isEntityId', () => {
  it('accepts and rejects exactly what the database accepts', () => {
    const samples = [
      '0192f0c4-7d4e-7c2a-9b1e-000000000001',
      '0192F0C4-7D4E-7C2A-9B1E-000000000001',
      '0192f0c4-7d4e-4c2a-9b1e-000000000001',
      '0192f0c4-7d4e-7c2a-7b1e-000000000001',
      '000000000000000000000000',
      '65f1c2a9e4b0a1b2c3d4e5f6',
      '65f1c2a9e4b0a1b2c3d4e5f',
      'not-an-id',
      '',
    ];
    for (const sample of samples)
      expect([sample, isEntityId(sample)]).toEqual([sample, isLiveEntityId(sample)]);
  });
});
