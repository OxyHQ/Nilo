import { type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  generatedId,
  inList,
  textArrayLiteral,
  timestamptz,
  updatedAt,
} from '@oxy.so/db';
import { blocks, pages } from './pages.js';
import { workspaces } from './workspaces.js';

/**
 * Collaboration domain: comments, share links, notifications and the two push
 * delivery registries.
 *
 * Conventions come from `workspaces.ts` — read it first. What is specific here:
 *
 * - `oxyUserId` / `authorId` / `createdBy` are `text`: Oxy user ids are opaque
 *   identifiers issued by the Oxy auth service and there is no users table to
 *   point at, so no format is imposed on them — see the note on
 *   `notifications.oxyUserId`.
 */

/* ────────────────────────── comments ────────────────────────── */

export const comments = pgTable(
  'comments',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * CASCADE, because a comment on a hard-deleted page is unreachable.
     *
     * None of the four hard-delete paths (`routes/pages.ts`,
     * `routes/workspaces.ts`, `routes/blocks.ts`, `routes/databases.ts`)
     * deletes comments itself. Both list queries reach a comment through its
     * page or its block, so an orphan would be invisible garbage; the cascade
     * collects it and changes nothing observable.
     *
     * NOT `restrict`: that would make all four of those deletes fail with a
     * foreign-key violation the moment a page carried a comment.
     */
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /**
     * null = page-level comment, not anchored to a specific block.
     *
     * SET NULL, and the difference from `pageId` above is the whole point.
     * `DELETE /blocks/:id` deletes a block and its descendants while the PAGE
     * SURVIVES (`routes/blocks.ts:598`) — an ordinary editing action. The page
     * comment list selects on `pageId`, not `blockId`
     * (`routes/comments.ts:383`), so a comment whose block was deleted is still
     * returned and still visible today, merely carrying a dangling id.
     *
     * CASCADE here would therefore delete a visible comment thread every time
     * someone removes a paragraph, presenting as "my comments disappeared" with
     * no error anywhere. SET NULL keeps the comment exactly as visible as it is
     * now and drops the dangling reference, which is the same call the sibling
     * port made on `pages.parentId` for the same reason.
     */
    blockId: text().references(() => blocks.id, { onDelete: 'set null' }),
    /**
     * null = top-level thread; set = reply.
     *
     * The cascade makes structural what `DELETE /comments/:id` already does by
     * hand — deleting a top-level comment deletes its replies
     * (`routes/comments.ts:706-712`). It does NOT express the one-level nesting
     * rule (a reply may only target a top-level comment): that is a check
     * across two rows, which no constraint can state, and it stays where it is
     * today, at the route.
     */
    parentCommentId: text(),
    authorId: text().notNull(),
    /**
     * Comment content, flattened into two columns.
     *
     * Two columns rather than one `jsonb` blob because BOTH halves are
     * required, and a single blob could not carry either constraint.
     *
     * Anything reading these must go through `repositories/comments.ts`, which
     * reassembles `{ segments, plainText }`. A caller reaching for
     * `row.content.plainText` on a raw row reads `undefined` and, in the
     * notification fan-out, would silently send an empty preview.
     */
    contentSegments: jsonb().notNull().default([]),
    contentPlainText: text().notNull().default(''),
    /** Set when the thread is resolved. null = open. */
    resolvedAt: timestamptz(),
    /** Set on edit. null = never edited. */
    editedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // "List comments for a page (resolved/unresolved split)".
    index('comments_page_resolved_created_idx').on(t.pageId, t.resolvedAt, t.createdAt),
    // "List comments on a block" — the inline badge count.
    index('comments_block_resolved_created_idx').on(t.blockId, t.resolvedAt, t.createdAt),
    // "List replies in a thread".
    index('comments_parent_created_idx').on(t.parentCommentId, t.createdAt),
    index('comments_workspace_idx').on(t.workspaceId),
    index('comments_author_idx').on(t.authorId),
    /**
     * Declared table-level rather than as a column-level `.references()`: a
     * column-level SELF reference has been silently dropped from both the
     * generated migration and the snapshot in other Oxy ports, so this shape is
     * the one that survives generation — and it is asserted against
     * `pg_constraint` in `collab-schema.pgdb.test.ts` rather than trusted from
     * the declaration.
     */
    foreignKey({
      columns: [t.parentCommentId],
      foreignColumns: [t.id],
      name: 'comments_parent_comment_id_fk',
    }).onDelete('cascade'),
    /**
     * No standalone `pageId` index: it would be a strict prefix of
     * `comments_page_resolved_created_idx`, which Postgres uses for a bare
     * `pageId` lookup. Same for a standalone `blockId` index, which the
     * compound covers.
     */
    /**
     * The declared TypeScript type of `segments` is `CommentSegment[]` and the
     * route validates it with Zod before every write. This is the storage-level
     * half of that claim, and it cannot reject anything the writer produces.
     */
    check('comments_segments_is_array', sql`jsonb_typeof(${t.contentSegments}) = 'array'`),
  ],
);

/* ───────────────────────── share_links ───────────────────────── */

export const SHARE_LINK_SCOPES = ['read', 'comment', 'edit'] as const;
export type ShareLinkScope = (typeof SHARE_LINK_SCOPES)[number];

export const shareLinks = pgTable(
  'share_links',
  {
    id: generatedId(),
    /**
     * CASCADE: a share link to a hard-deleted page grants access to nothing.
     * `GET /api/share/:token` already 404s once the page is gone
     * (`routes/share-links.ts:316-320`), so the row is dead weight that still
     * occupies its unique token.
     */
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /**
     * The url-safe random token, stored VERBATIM.
     *
     * It is the sole lookup key for the unauthenticated `GET /api/share/:token`
     * endpoint (`routes/share-links.ts:302`), so it is matched on. It must
     * therefore never be encrypted with a randomised IV and never hashed with a
     * per-row salt — either makes the equality lookup match nothing, and the
     * only symptom is a 404 on every share link ever issued. 192 bits of
     * `crypto.randomBytes` is what protects it, not storage transformation.
     */
    token: text().notNull(),
    scope: text().notNull().default('read'),
    /** Oxy user id of the creator. */
    createdBy: text().notNull(),
    /**
     * Optional expiry; null = never expires.
     *
     * APPLICATION-level expiry, checked on read at `routes/share-links.ts:311`
     * and filtered in the list query at `:201`. It gets no expiry-sweep entry:
     * an expired share link stops granting access but the row survives, so
     * revoking and expiring stay distinguishable and the audit trail is not
     * silently destroyed.
     */
    expiresAt: timestamptz(),
    /** Set when revoked. null = still active. */
    revokedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Public lookup by token. Unique so a single-row read is sound.
     *
     * NO partial predicate. `token` is required, and the reflex to add one is
     * worth naming anyway: a Postgres unique is
     * NULLS DISTINCT by default, so a predicate would only ever be about
     * meaning, never about null collisions.
     */
    uniqueIndex('share_links_token_key').on(t.token),
    // "List active share links for a page".
    index('share_links_page_revoked_created_idx').on(t.pageId, t.revokedAt, t.createdAt.desc()),
    check('share_links_scope', sql`${t.scope} in (${sql.raw(inList(SHARE_LINK_SCOPES))})`),
  ],
);

/* ──────────────────────── notifications ──────────────────────── */

export const NOTIFICATION_TYPES = ['mention', 'comment_reply'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'read', 'dismissed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** The statuses `getUnreadCount` counts — the partial index's predicate. */
export const NOTIFICATION_UNREAD_STATUSES = ['pending', 'sent'] as const;

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** 90 days: how long a dismissed notification is kept. */
export const NOTIFICATION_DISMISSED_RETENTION_SECONDS = 90 * 24 * 60 * 60;

export const notifications = pgTable(
  'notifications',
  {
    id: generatedId(),
    /**
     * Oxy user id — opaque `text`.
     *
     * An id of any shape is accepted; one that matches no rows produces an
     * empty notification list rather than an error.
     * `repositories/notifications.ts` therefore adds no format guard — there
     * is no users table to validate against — and the behaviour is pinned by a
     * test.
     */
    oxyUserId: text().notNull(),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** Free-form payload. `Schema.Types.Mixed`, optional. */
    data: jsonb(),
    /**
     * Channels this notification was fanned out to.
     *
     * The CHECK is containment, which is trivially true for `{}` — accepted,
     * because the field is not required.
     * `sendNotification` always writes at least `['in_app']`.
     */
    channels: text().array().notNull().default([]),
    /** `Record<channel, 'pending' | 'sent' | 'failed'>`. */
    deliveryStatus: jsonb().notNull().default({}),
    status: text().notNull().default('pending'),
    priority: text().notNull().default('normal'),
    readAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /**
     * The TTL replacement, and the reason it is a GENERATED column.
     *
     * The retention rule is PARTIAL: delete 90 days after `createdAt`, but
     * only while `status = 'dismissed'`. `@oxy.so/db`'s `ExpirySweepTarget`
     * carries `{ table, column, retentionSeconds }` and has no predicate, so a
     * naive entry pointed at `createdAt` would delete every notification older
     * than 90 days including read and pending ones — a silent history wipe, and
     * the cheapest way to make a "TTL is registered" gate go green.
     *
     * Moving the predicate into the column keeps the shared sweep as the ONE
     * expiry mechanism and states the rule exactly: null while the row is
     * not dismissed (and `null <= now() - interval` is null, so the row is never
     * selected), `createdAt` once it is. A notification created 100 days ago and
     * dismissed today is reaped on the next sweep.
     */
    dismissedReapAt: timestamptz().generatedAlwaysAs(
      (): SQL =>
        sql`case when ${notifications.status} = 'dismissed' then ${notifications.createdAt} end`,
    ),
  },
  (t) => [
    // Notification feed: user + status, newest first.
    index('notifications_user_status_created_idx').on(t.oxyUserId, t.status, t.createdAt.desc()),
    /**
     * Unread count. The predicate is GENUINE — it is the `$in` from
     * `getUnreadCount` (`lib/notification-service.ts`), not a null-collision
     * workaround.
     */
    index('notifications_user_unread_idx')
      .on(t.oxyUserId, t.status)
      .where(sql`${t.status} in (${sql.raw(inList(NOTIFICATION_UNREAD_STATUSES))})`),
    /**
     * The sweep's driving index. `ExpirySweepTarget` requires the retention
     * column be indexed; partial because only dismissed rows are ever
     * non-null, so the index stays the size of the dismissed backlog.
     */
    index('notifications_dismissed_reap_idx')
      .on(t.dismissedReapAt)
      .where(sql`${t.dismissedReapAt} is not null`),
    check('notifications_type', sql`${t.type} in (${sql.raw(inList(NOTIFICATION_TYPES))})`),
    check('notifications_status', sql`${t.status} in (${sql.raw(inList(NOTIFICATION_STATUSES))})`),
    check(
      'notifications_priority',
      sql`${t.priority} in (${sql.raw(inList(NOTIFICATION_PRIORITIES))})`,
    ),
    check(
      'notifications_channels',
      sql`${t.channels} <@ ${sql.raw(textArrayLiteral(NOTIFICATION_CHANNELS))}`,
    ),
    check(
      'notifications_delivery_status_is_object',
      sql`jsonb_typeof(${t.deliveryStatus}) = 'object'`,
    ),
  ],
);

/* ───────────────────────── push_tokens ───────────────────────── */

export const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: generatedId(),
    /** Oxy user id — see the note on `notifications.oxyUserId`. */
    oxyUserId: text().notNull(),
    /**
     * Expo push token, stored verbatim: it is matched on directly
     * (`lib/notification-service.ts:168` deactivates by token alone, across
     * every user that registered that device).
     */
    token: text().notNull(),
    deviceId: text(),
    /**
     * The CHECK matches the route: `routes/notifications.ts` rejects any other
     * value with a 400 before the upsert, so no row outside this set can be
     * written. A NULL is
     * admitted, because `null in (...)` is NULL and a CHECK rejects only FALSE
     * — `platform` is optional and rows without one are legitimate.
     */
    platform: text(),
    active: boolean().notNull().default(true),
    lastUsedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A user registers a given token at most once — the upsert's conflict target.
    uniqueIndex('push_tokens_user_token_key').on(t.oxyUserId, t.token),
    // Receipt error handling looks a token up without knowing the user.
    index('push_tokens_token_idx').on(t.token),
    /**
     * The standalone `{ oxyUserId: 1 }` from `index: true` is NOT ported: it is
     * a strict prefix of `push_tokens_user_token_key`, which serves the
     * "active tokens for this user" read.
     */
    check('push_tokens_platform', sql`${t.platform} in (${sql.raw(inList(PUSH_PLATFORMS))})`),
  ],
);

/* ─────────────────── web_push_subscriptions ─────────────────── */

export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: generatedId(),
    /** Oxy user id — see the note on `notifications.oxyUserId`. */
    oxyUserId: text().notNull(),
    /** Browser push endpoint URL — matched on, stored verbatim. */
    endpoint: text().notNull(),
    /**
     * The subscription's `keys: { p256dh, auth }` object, flattened.
     *
     * `web-push` needs them reassembled as `{ p256dh, auth }`
     * (`lib/notification-service.ts:254`), which
     * `repositories/webPushSubscriptions.ts` does. Read a raw row and
     * `sub.keys` is `undefined`, which `webPush.sendNotification` reports as a
     * malformed subscription rather than as a missing column.
     *
     * Stored in plaintext: they are the client's own public key and auth
     * secret for a single browser endpoint.
     */
    keyP256dh: text().notNull(),
    keyAuth: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One subscription per (user, endpoint) — the upsert's conflict target.
    uniqueIndex('web_push_subscriptions_user_endpoint_key').on(t.oxyUserId, t.endpoint),
    /**
     * The standalone `{ oxyUserId: 1 }` from `index: true` is NOT ported — a
     * strict prefix of the unique above.
     */
  ],
);
