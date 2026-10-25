import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('uses real product/platform SDK mint and refresh without changing delivery idempotency', () => {
  const result = spawnSync(
    'bun',
    [fileURLToPath(new URL('./fixtures/producer-probe.ts', import.meta.url))],
    {
      encoding: 'utf8',
      timeout: 15_000,
      env: process.env,
    },
  );
  expect({
    exit: result.status,
    signal: result.signal,
    error: result.error?.message,
    stderr: result.stderr,
  }).toEqual({ exit: 0, signal: null, error: undefined, stderr: '' });
  expect(result.stdout).toBe('NILO_PRODUCER_TRANSPORT_OK\n');
});
