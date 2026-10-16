/**
 * Expo push token reads and writes, covering every query
 * `routes/notifications.ts` and `lib/notification-service.ts` perform against
 * the token registry.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { NiloDatabase } from '../db/client.js';
import { type PushApp, type PushPlatform, pushTokens } from '../db/schema/collab.js';

export interface PushTokenRow {
  id: string;
  oxyUserId: string;
  token: string;
  deviceId: string | null;
  platform: PushPlatform | null;
  app: PushApp;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertPushTokenInput {
  oxyUserId: string;
  token: string;
  /** Omitted or empty leaves any existing value alone — see below. */
  deviceId?: string;
  /** Omitted or empty leaves any existing value alone — see below. */
  platform?: PushPlatform;
  /** The app registering the token; Nilo when omitted. */
  app?: PushApp;
}

function toPushTokenRow(row: typeof pushTokens.$inferSelect): PushTokenRow {
  return { ...row, platform: row.platform as PushPlatform | null };
}

/**
 * Register a token, or reactivate the one this user already registered.
 *
 * Reproduces the route's conditional spread
 * (`{ ...(deviceId && { deviceId }), ...(platform && { platform }) }`,
 * `routes/notifications.ts:139-147`): a request that omits `deviceId` must not
 * erase the one recorded when the device first registered. `coalesce(excluded.…,
 * push_tokens.…)` is that rule in SQL — an omitted field arrives as NULL and the
 * stored value wins. There is consequently no way to CLEAR either field through
 * this path.
 *
 * `excluded.<column>` is spelled through `sqlColumnName`, not by interpolating
 * the column object: drizzle would emit the JavaScript PROPERTY name, so
 * `deviceId` would render as `excluded.deviceid` and fail with 42703 at runtime.
 */
export async function upsertPushToken(
  db: NiloDatabase,
  input: UpsertPushTokenInput,
): Promise<PushTokenRow> {
  const excludedDeviceId = sql.identifier(sqlColumnName(pushTokens.deviceId));
  const excludedPlatform = sql.identifier(sqlColumnName(pushTokens.platform));

  const rows = await db
    .insert(pushTokens)
    .values({
      oxyUserId: input.oxyUserId,
      token: input.token,
      deviceId: input.deviceId || null,
      platform: input.platform || null,
      app: input.app ?? 'nilo',
    })
    .onConflictDoUpdate({
      target: [pushTokens.oxyUserId, pushTokens.token],
      set: {
        active: true,
        app: input.app ?? 'nilo',
        deviceId: sql`coalesce(excluded.${excludedDeviceId}, ${pushTokens.deviceId})`,
        platform: sql`coalesce(excluded.${excludedPlatform}, ${pushTokens.platform})`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('upsertPushToken wrote no row');
  }
  return toPushTokenRow(row);
}

/**
 * Deactivate one user's registration of a token.
 *
 * Returns the row count — the number of matched rows. The route 404s on zero.
 */
export async function deactivatePushToken(
  db: NiloDatabase,
  oxyUserId: string,
  token: string,
): Promise<number> {
  const rows = await db
    .update(pushTokens)
    .set({ active: false })
    .where(and(eq(pushTokens.oxyUserId, oxyUserId), eq(pushTokens.token, token)))
    .returning({ id: pushTokens.id });
  return rows.length;
}

/**
 * Deactivate EVERY registration of a token, across users.
 *
 * Chosen deliberately: the caller (`lib/notification-service.ts`) is handling a
 * `DeviceNotRegistered` receipt, which means the device is gone for everyone,
 * so every row naming it is stale.
 */
export async function deactivatePushTokenEverywhere(
  db: NiloDatabase,
  token: string,
): Promise<number> {
  const rows = await db
    .update(pushTokens)
    .set({ active: false })
    .where(eq(pushTokens.token, token))
    .returning({ id: pushTokens.id });
  return rows.length;
}

/** Deactivate one row by primary key — the malformed-token path. */
export async function deactivatePushTokenById(db: NiloDatabase, id: string): Promise<number> {
  const rows = await db
    .update(pushTokens)
    .set({ active: false })
    .where(eq(pushTokens.id, id))
    .returning({ id: pushTokens.id });
  return rows.length;
}

/** Every active token for a user — the push fan-out's input. */
export async function listActivePushTokens(
  db: NiloDatabase,
  oxyUserId: string,
): Promise<PushTokenRow[]> {
  const rows = await db
    .select()
    .from(pushTokens)
    .where(and(eq(pushTokens.oxyUserId, oxyUserId), eq(pushTokens.active, true)));
  return rows.map(toPushTokenRow);
}

/**
 * Whether a user has any active token — the channel-resolution check.
 *
 * Returns a boolean. A permission-shaped question is answered with a boolean
 * rather than a row on purpose: nothing downstream can leak a value it was never
 * handed.
 */
export async function hasActivePushToken(db: NiloDatabase, oxyUserId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(pushTokens)
    .where(and(eq(pushTokens.oxyUserId, oxyUserId), eq(pushTokens.active, true)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Stamp `lastUsedAt` on the tokens a send reached.
 *
 * The empty-input early return is a saved round trip, not a guard:
 * `inArray(col, [])` renders as the literal `false`, so the statement would be
 * correct without it.
 */
export async function touchPushTokensLastUsed(
  db: NiloDatabase,
  ids: readonly string[],
  lastUsedAt: Date,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(pushTokens)
    .set({ lastUsedAt })
    .where(inArray(pushTokens.id, [...ids]))
    .returning({ id: pushTokens.id });
  return rows.length;
}
