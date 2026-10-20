import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';

/**
 * Reference shape for every schema file in this folder. Conventions, and why:
 *
 * - `generatedId()` — uuidv7. NOT monotonic within a millisecond (~50%
 *   inversions), unlike the ObjectId it replaces, so nothing may infer
 *   creation order from an id. Tests that need an order write explicit
 *   timestamps.
 * - Enums are `text` plus a CHECK built from the exported constant, never
 *   `pgEnum`: adding a value is then an ordinary migration instead of an
 *   `ALTER TYPE`, and removing one is possible at all.
 * - `inList` renders the CHECK's literal side. A value interpolated into a
 *   `check()` becomes the literal `$1` in the generated migration and fails at
 *   APPLY time, so the constant side never goes through a bound parameter.
 * - Column names are derived by `DATABASE_CASING`; they are never spelled by
 *   hand. Anywhere SQL needs the identifier rather than the property, use
 *   `sqlColumnName` — interpolating the column object emits the JS property
 *   name, so `workspaceId` would become `workspaceid` and fail with 42703.
 */

/**
 * Ordered weakest to strongest. The ORDER is the permission model — `hasRole`
 * reads it positionally — so reordering this array silently changes who can do
 * what, and the CHECK below is derived from it so the database and the
 * comparison cannot disagree about which roles exist.
 */
export const WORKSPACE_ROLES = ['viewer', 'commenter', 'editor', 'admin', 'owner'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Negative when `a` is weaker than `b`, zero when equal, positive when stronger. */
export function compareRoles(a: WorkspaceRole, b: WorkspaceRole): number {
  return WORKSPACE_ROLES.indexOf(a) - WORKSPACE_ROLES.indexOf(b);
}

/** Whether `actual` meets or exceeds `required`. */
export function hasRole(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return compareRoles(actual, required) >= 0;
}

export const WORKSPACE_NAME_MAX = 200;

export const workspaces = pgTable(
  'workspaces',
  {
    id: generatedId(),
    name: text().notNull(),
    /**
     * Oxy file id of the workspace's picture, rendered through Oxy's public
     * asset URL. Null shows the name's initials.
     */
    avatar: text(),
    /**
     * Oxy user id. Text, not a uuid and not a foreign key: Oxy user ids are
     * opaque identifiers issued by the Oxy auth service and there is no users
     * table in this database to point at.
     */
    ownerId: text().notNull(),
    isPersonal: boolean().notNull().default(false),
    /**
     * Soft delete. `DELETE /api/workspaces/:id` stamps this rather than
     * removing the row, so pages that reference the workspace still resolve.
     */
    archivedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Owner lookup: list workspaces a user owns, personal separated from team.
    index('workspaces_owner_personal_idx').on(t.ownerId, t.isPersonal),
    /**
     * At most one personal workspace per owner.
     *
     * This predicate is REAL, not a null-collision workaround: a Postgres
     * unique is NULLS DISTINCT by default and needs none for that. Here the
     * predicate carries meaning: a user may
     * own many non-personal workspaces, so the uniqueness applies only to the
     * personal one.
     */
    uniqueIndex('unique_personal_workspace_per_owner').on(t.ownerId).where(sql`${t.isPersonal}`),
    /**
     * A personal workspace is never archived. It can be reset, but the user
     * always has it: the route refuses to archive one, and this makes a bug in
     * any other writer fail loudly instead of hiding the workspace.
     */
    check(
      'workspaces_personal_not_archived',
      sql`not (${t.isPersonal} and ${t.archivedAt} is not null)`,
    ),
    /**
     * Workspace names are capped at `WORKSPACE_NAME_MAX` characters as a live
     * constraint.
     */
    check(
      'workspaces_name_length',
      sql`char_length(${t.name}) <= ${sql.raw(String(WORKSPACE_NAME_MAX))}`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: generatedId(),
    /**
     * A member row pointing at a workspace that does not exist is garbage,
     * and the foreign key makes that structural. Cascade covers the hard
     * delete; the ordinary path soft-deletes the workspace and leaves members
     * in place.
     */
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Oxy user id — see the note on `workspaces.ownerId`. */
    userId: text().notNull(),
    /**
     * `$type` so the column and the CHECK below say the same thing. Without it
     * the column reads as `string` and every consumer narrows it by hand or
     * casts -- a property the database enforces needs a gate in the type
     * system too, or the two drift and only one of them fails.
     */
    role: text().$type<WorkspaceRole>().notNull().default('viewer'),
    /** User id of the inviter, or null for the auto-created owner row. */
    invitedBy: text(),
    joinedAt: timestamptz().notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A user is a member of a given workspace at most once.
    uniqueIndex('workspace_members_workspace_user_key').on(t.workspaceId, t.userId),
    // "List my workspaces".
    index('workspace_members_user_joined_idx').on(t.userId, t.joinedAt.desc()),
    // `inList` renders the members WITHOUT surrounding parentheses
    // (`'viewer', 'editor'`), so the parentheses belong to the caller. Verified
    // against the real function rather than assumed — the version without them
    // generates `role in 'viewer', ...`, which fails at apply time.
    check('workspace_members_role', sql`${t.role} in (${sql.raw(inList(WORKSPACE_ROLES))})`),
  ],
);

/** The roles an invitation by email can give: anything but `owner`. */
export const INVITABLE_WORKSPACE_ROLES = ['viewer', 'commenter', 'editor', 'admin'] as const;
export type InvitableWorkspaceRole = (typeof INVITABLE_WORKSPACE_ROLES)[number];

/** How long an invitation to someone without an Oxy account waits for them. */
export const WORKSPACE_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * An invitation addressed to an email that is not (yet) an Oxy account. When
 * someone whose Oxy email is this one lists their workspaces, it is accepted
 * (`acceptPendingInvites`): they become a member with `role`. An accepted
 * invitation stays as the record of who was invited; a revoked one is deleted.
 */
export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Always lower-cased: the CHECK below holds every writer to it. */
    email: text().notNull(),
    role: text().$type<InvitableWorkspaceRole>().notNull(),
    /** Oxy user id of whoever invited them. */
    invitedBy: text().notNull(),
    createdAt: createdAt(),
    expiresAt: timestamptz().notNull(),
    /** When the invitation became a membership; null while it waits. */
    acceptedAt: timestamptz(),
    /**
     * The secret of the invitation's link (`/invite/<token>`), which the
     * invitation email carries: whoever opens it signed in accepts THIS
     * invitation, with whatever Oxy email they have. Kept when the invitation is
     * renewed, so a link already sent keeps working. Null only on invitations
     * made before links existed, which have no link to share.
     */
    token: text(),
  },
  (t) => [
    // One waiting invitation per person and workspace; a new one replaces it.
    uniqueIndex('workspace_invites_pending_key')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} is null`),
    // "Invitations waiting for me", read when a person lists their workspaces.
    index('workspace_invites_pending_email_idx').on(t.email).where(sql`${t.acceptedAt} is null`),
    // An invitation link resolves by its secret.
    uniqueIndex('workspace_invites_token_key').on(t.token),
    check('workspace_invites_email_lower', sql`${t.email} = lower(${t.email})`),
    check(
      'workspace_invites_role',
      sql`${t.role} in (${sql.raw(inList(INVITABLE_WORKSPACE_ROLES))})`,
    ),
  ],
);

/** The roles a workspace's join link can give: never more than editing. */
export const WORKSPACE_LINK_ROLES = ['viewer', 'commenter', 'editor'] as const;
export type WorkspaceLinkRole = (typeof WORKSPACE_LINK_ROLES)[number];

/**
 * A workspace's join link, Notion's "invite link": anyone signed in who opens
 * it becomes a member with `role`. A workspace has at most one live link;
 * disabling stamps `revokedAt`, regenerating revokes it and makes another with
 * a new token. The members a link brought in stay when it goes.
 */
export const workspaceInviteLinks = pgTable(
  'workspace_invite_links',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    token: text().notNull(),
    role: text().$type<WorkspaceLinkRole>().notNull(),
    /** Oxy user id of whoever made it. */
    createdBy: text().notNull(),
    createdAt: createdAt(),
    revokedAt: timestamptz(),
  },
  (t) => [
    uniqueIndex('workspace_invite_links_token_key').on(t.token),
    uniqueIndex('workspace_invite_links_live_key')
      .on(t.workspaceId)
      .where(sql`${t.revokedAt} is null`),
    check(
      'workspace_invite_links_role',
      sql`${t.role} in (${sql.raw(inList(WORKSPACE_LINK_ROLES))})`,
    ),
  ],
);
