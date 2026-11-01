/** Run the generated DDL in an isolated schema with a real hot-table lock. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { runMigrations } from '@oxy.so/db/migrate';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  testDatabaseUrl,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';

let db: TestDatabase;
const schemaName = `generation_migration_${randomBytes(6).toString('hex')}`;
beforeAll(async () => {
  db = await getTestDb();
  await db.execute(sql`create schema ${sql.identifier(schemaName)}`);
});
afterAll(async () => {
  await db.execute(sql`drop schema ${sql.identifier(schemaName)} cascade`);
  await closeTestDb();
});
describe('notes generation migration', () => {
  it('applies the full journal once and makes the second migration a no-op', async () => {
    const databaseUrl = await createTestDatabase({ adminUrl: testDatabaseUrl() });
    const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      const options = {
        databaseUrl,
        expectedDatabase: new URL(databaseUrl).pathname.slice(1),
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
        extensions: [],
        run: 'all' as const,
        dryRun: false,
        logger: { info: () => {}, debug: () => {} },
      };
      await runMigrations(options);
      const before = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(before[0]?.count).toBeGreaterThan(0);
      const table = await client`select to_regclass('public.notes_sync_generations')::text as name`;
      expect(table[0]?.name).toBe('notes_sync_generations');
      await runMigrations(options);
      const after = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await client.end();
      await dropTestDatabase(databaseUrl);
    }
  }, 30000);

  it('applies and rolls back its actual DDL while workspaces has an exclusive lock', async () => {
    const ddl = readFileSync(
      new URL('../../drizzle/0057_notes_sync_generation.sql', import.meta.url),
      'utf8',
    );
    expect(ddl).toContain('-- oxy:deploy-phase=pre');
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`lock table public.workspaces in access exclusive mode`);
      reached();
      await gate;
    });
    try {
      await held;
      await expect(
        Promise.race([
          db.transaction(async (tx) => {
            await tx.execute(sql`set local search_path to ${sql.identifier(schemaName)}, public`);
            await tx.execute(sql.raw(ddl));
            throw new Error('rollback probe');
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('DDL waited for workspaces')), 1500),
          ),
        ]),
      ).rejects.toThrow('rollback probe');
      const rows = await db.execute<{ name: string | null }>(
        sql`select to_regclass(${`${schemaName}.notes_sync_generations`})::text as name`,
      );
      expect(rows[0]?.name).toBeNull();
    } finally {
      release();
      await blocker;
    }
  });
});
