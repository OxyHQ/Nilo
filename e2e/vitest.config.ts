import { defineConfig } from 'vitest/config';

/**
 * End-to-end tests that drive the app's client code against the API, on a
 * real PostgreSQL (`NILO_TEST_DATABASE_URL`). Run with `bun run test:e2e`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
