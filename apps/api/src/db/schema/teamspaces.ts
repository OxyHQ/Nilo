import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import { workspaces } from './workspaces.js';

/**
 * Who sees a teamspace and its pages (see `docs/access.md`): `open` — every
 * member of the workspace opens its pages and may join; `closed` — listed,
 * its pages only for its members; `private` — only its members know of it.
 */
export const TEAMSPACE_PRIVACIES = ['open', 'closed', 'private'] as const;
export type TeamspacePrivacy = (typeof TEAMSPACE_PRIVACIES)[number];

/** `owner`s manage the teamspace (settings, members); `member`s belong to it. */
export const TEAMSPACE_ROLES = ['member', 'owner'] as const;
export type TeamspaceRole = (typeof TEAMSPACE_ROLES)[number];

export const TEAMSPACE_NAME_MAX = 200;

/** A group of a workspace's members with its own pages, as in Notion. */
export const teamspaces = pgTable(
  'teamspaces',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    icon: text(),
    description: text().notNull().default(''),
    privacy: text().$type<TeamspacePrivacy>().notNull().default('open'),
    /**
     * The workspace's default teamspace: open, every member belongs to it,
     * and top-level pages created without a place go to it. One per workspace.
     */
    isDefault: boolean().notNull().default(false),
    /** Oxy user id of its creator. */
    createdBy: text().notNull(),
    /** Archived teamspaces are hidden; their pages stay where they are. */
    archivedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('teamspaces_workspace_idx').on(t.workspaceId),
    uniqueIndex('teamspaces_one_default_per_workspace')
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
    check('teamspaces_privacy', sql`${t.privacy} in (${sql.raw(inList(TEAMSPACE_PRIVACIES))})`),
    check(
      'teamspaces_name_length',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(TEAMSPACE_NAME_MAX))}`,
    ),
  ],
);

export const teamspaceMembers = pgTable(
  'teamspace_members',
  {
    teamspaceId: text()
      .notNull()
      .references(() => teamspaces.id, { onDelete: 'cascade' }),
    /** Oxy user id. */
    userId: text().notNull(),
    role: text().$type<TeamspaceRole>().notNull().default('member'),
    joinedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamspaceId, t.userId] }),
    // "My teamspaces" for the sidebar.
    index('teamspace_members_user_idx').on(t.userId),
    check('teamspace_members_role', sql`${t.role} in (${sql.raw(inList(TEAMSPACE_ROLES))})`),
  ],
);
