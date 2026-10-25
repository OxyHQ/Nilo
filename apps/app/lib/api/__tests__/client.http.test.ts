/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('uses real Axios and core HTTP for anonymous, authenticated and switching sessions', () => {
  // Expo's preset replaces network APIs; the child runs the production modules and real HTTP.
  const result = spawnSync('bun', [resolve(__dirname, '../fixtures/client-probe.ts')], {
    encoding: 'utf8',
    timeout: 15_000,
    env: process.env,
  });
  expect({
    exit: result.status,
    signal: result.signal,
    error: result.error?.message,
    stderr: result.stderr,
  }).toEqual({ exit: 0, signal: null, error: undefined, stderr: '' });
  expect(result.stdout).toBe('NILO_SHARED_TRANSPORT_OK\n');
});
