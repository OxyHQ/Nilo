import { and, eq, inArray, like } from 'drizzle-orm';
import { constraintNameOf, isCheckViolation } from '@oxy.so/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comments, notifications, reminders } from '../../db/schema/collab.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { teamspaceMembers, teamspaces } from '../../db/schema/teamspaces.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import { createComment } from '../comments.js';
import { insertDatabase } from '../databases.js';
import { createPage } from '../pages.js';
import { createTeamspace } from '../teamspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import {
  addMember,
  addMemberIfAbsent,
  archiveWorkspace,
  createPersonalWorkspaceIfAbsent,
  createWorkspace,
  findLiveWorkspaceById,
  findMembership,
  findPersonalWorkspace,
  findProvisionedPersonalWorkspace,
  listLiveWorkspacesByIds,
  listMembershipsForUsers,
  provisionPersonalWorkspace,
  removeMember,
  resetPersonalWorkspace,
  updateMemberRole,
  updateWorkspace,
} from '../workspaces.js';

let db: TestDatabase;

/** Every owner id this file writes carries this prefix. */
const scope = testScope('ws-repo');
const owner = `${scope}-owner`;

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  // Scoped to the rows this file owns. Members go with the workspace cascade.
  await db.delete(notifications).where(like(notifications.oxyUserId, `${scope}%`));
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeTestDb();
});

describe('workspaces repository', () => {
  it('round-trips a workspace and folds archived into "not found"', async () => {
    const ws = await createWorkspace(db, { name: 'Team', ownerId: owner });
    expect(await findLiveWorkspaceById(db, ws.id)).toMatchObject({ name: 'Team' });

    await archiveWorkspace(db, ws.id);

    // The two callers both turn "missing" and "archived" into the same 404, so
    // the repository gives them one answer rather than inviting a caller to
    // check existence and forget the archive.
    expect(await findLiveWorkspaceById(db, ws.id)).toBeNull();
  });

  it('excludes archived workspaces from a bulk read', async () => {
    const live = await createWorkspace(db, { name: 'Live', ownerId: `${scope}-bulk` });
    const dead = await createWorkspace(db, { name: 'Dead', ownerId: `${scope}-bulk` });
    await archiveWorkspace(db, dead.id);

    const rows = await listLiveWorkspacesByIds(db, [live.id, dead.id]);
    expect(rows.map((r) => r.id)).toEqual([live.id]);
  });

  it('returns nothing for an empty id list without asking the database', async () => {
    // `inArray` with an empty list renders as the literal `false` — correct,
    // but a wasted round trip. The guard is the saving, not a behaviour change.
    expect(await listLiveWorkspacesByIds(db, [])).toEqual([]);
  });
});

describe('the personal-workspace race', () => {
  it('creates exactly one and returns null to the loser', async () => {
    const racer = `${scope}-race`;
    const first = await createPersonalWorkspaceIfAbsent(db, { name: 'A', ownerId: racer });
    const second = await createPersonalWorkspaceIfAbsent(db, { name: 'B', ownerId: racer });

    expect(first).not.toBeNull();
    // Null, not a throw. A ported `code === 11000` catch cannot tell a
    // duplicate from a dropped connection, so it would report "already
    // provisioned" for an infrastructure failure; the empty result is the
    // answer instead and a real failure still propagates.
    expect(second).toBeNull();

    const found = await findPersonalWorkspace(db, racer);
    expect(found?.name).toBe('A');
  });

  it('still lets one owner hold many NON-personal workspaces', async () => {
    // The negative control for the partial predicate. Without it the unique
    // would be over `ownerId` alone and this would fail — which is exactly how
    // an over-broad index passes a test that only checks the personal case.
    const many = `${scope}-many`;
    await createWorkspace(db, { name: 'One', ownerId: many });
    await createWorkspace(db, { name: 'Two', ownerId: many });

    const rows = await db.select().from(workspaces).where(eq(workspaces.ownerId, many));
    expect(rows).toHaveLength(2);
  });
});

describe('membership', () => {
  it('reports a duplicate loudly for the invite path', async () => {
    const ws = await createWorkspace(db, { name: 'Invites', ownerId: `${scope}-inv` });
    const first = await addMember(db, { workspaceId: ws.id, userId: 'u1', role: 'editor' });
    expect('member' in first).toBe(true);

    const second = await addMember(db, { workspaceId: ws.id, userId: 'u1', role: 'viewer' });
    // A 409 for the user, reached through the SQLSTATE on `cause`. A ported
    // `err.code === '23505'` matches nothing and this branch never runs.
    expect(second).toEqual({ duplicate: true });
  });

  it('stays quiet about a duplicate on the idempotent provisioning path', async () => {
    const ws = await createWorkspace(db, { name: 'Provision', ownerId: `${scope}-prov` });
    expect(
      await addMemberIfAbsent(db, { workspaceId: ws.id, userId: 'u2', role: 'owner' }),
    ).not.toBeNull();
    expect(
      await addMemberIfAbsent(db, { workspaceId: ws.id, userId: 'u2', role: 'owner' }),
    ).toBeNull();
  });

  it('reads a removal off RETURNING, not a row count', async () => {
    const ws = await createWorkspace(db, { name: 'Removals', ownerId: `${scope}-rm` });
    await addMember(db, { workspaceId: ws.id, userId: 'u3', role: 'viewer' });

    expect(await removeMember(db, ws.id, 'u3')).toBe(true);
    // The second call must report false. `rows.length` on a bare DELETE is 0
    // either way, so a naive port answers false for both — or true for both.
    expect(await removeMember(db, ws.id, 'u3')).toBe(false);
  });

  it('scopes a membership lookup to one workspace', async () => {
    const a = await createWorkspace(db, { name: 'A', ownerId: `${scope}-scope` });
    const b = await createWorkspace(db, { name: 'B', ownerId: `${scope}-scope` });
    await addMember(db, { workspaceId: a.id, userId: 'u4', role: 'admin' });

    expect(await findMembership(db, a.id, 'u4')).toMatchObject({ role: 'admin' });
    expect(await findMembership(db, b.id, 'u4')).toBeNull();
  });

  it('reads only the users asked for', async () => {
    const ws = await createWorkspace(db, { name: 'Mentions', ownerId: `${scope}-mention` });
    await addMember(db, { workspaceId: ws.id, userId: 'm1', role: 'editor' });
    await addMember(db, { workspaceId: ws.id, userId: 'm2', role: 'viewer' });

    const found = await listMembershipsForUsers(db, ws.id, ['m1', 'nobody']);
    expect(found.map((m) => m.userId)).toEqual(['m1']);
    expect(await listMembershipsForUsers(db, ws.id, [])).toEqual([]);
  });

  it('refuses a role the CHECK does not allow', async () => {
    const ws = await createWorkspace(db, { name: 'Roles', ownerId: `${scope}-role` });

    // Asserted through `constraintNameOf`, not by matching the error MESSAGE.
    // A drizzle error's message is only "Failed query: insert into ..." — the
    // SQLSTATE and the constraint name live on `cause`, which is the same
    // reason a ported `err.code === '23505'` matches nothing. Matching the
    // message here would have passed for any failure at all, including a
    // dropped connection.
    const error = await db
      .insert(workspaceMembers)
      // The type says this is impossible; the database has to say so too, or a
      // raw write reaches the table with a role nothing can interpret.
      .values({ workspaceId: ws.id, userId: 'u5', role: 'wizard' as never })
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(error).not.toBeNull();
    expect(isCheckViolation(error)).toBe(true);
    expect(constraintNameOf(error)).toBe('workspace_members_role');
  });
});

describe('patching', () => {
  it('leaves a field alone when the caller omits it', async () => {
    const ws = await createWorkspace(db, {
      name: 'Before',
      avatar: '65fdc8c8c8c8c8c8c8c8c8c8',
      ownerId: `${scope}-patch`,
    });

    const updated = await updateWorkspace(db, ws.id, { name: 'After' });
    // An `undefined` field must be skipped, not written as NULL. This is the
    // assertion that a patch does not quietly erase a sibling field.
    expect(updated).toMatchObject({ name: 'After', avatar: '65fdc8c8c8c8c8c8c8c8c8c8' });
  });

  it('accepts an explicit null as a real erasure', async () => {
    const ws = await createWorkspace(db, {
      name: 'Avatar',
      avatar: '65fdc8c8c8c8c8c8c8c8c8c8',
      ownerId: `${scope}-null`,
    });
    expect(await updateWorkspace(db, ws.id, { avatar: null })).toMatchObject({ avatar: null });
  });

  it('returns the row unchanged for an empty patch', async () => {
    const ws = await createWorkspace(db, { name: 'Same', ownerId: `${scope}-empty` });
    // An empty `.set()` is a syntax error rather than a no-op, so the guard is
    // load-bearing and this is what pins it.
    expect(await updateWorkspace(db, ws.id, {})).toMatchObject({ name: 'Same' });
  });

  it('returns null when the target does not exist', async () => {
    expect(await updateWorkspace(db, 'no-such-id', { name: 'x' })).toBeNull();
    expect(await archiveWorkspace(db, 'no-such-id')).toBeNull();
    expect(await updateMemberRole(db, 'no-such-id', 'nobody', 'viewer')).toBeNull();
  });
});

describe('the personal workspace', () => {
  const ownerRows = (workspaceId: string) =>
    db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));

  it('is provisioned whole: workspace, owner member and default teamspace', async () => {
    const user = `${scope}-whole`;
    const ws = await provisionPersonalWorkspace(db, { ownerId: user, name: 'Mine' });

    expect(ws).toMatchObject({ isPersonal: true, ownerId: user, name: 'Mine' });
    expect(await ownerRows(ws.id)).toEqual([
      expect.objectContaining({ userId: user, role: 'owner' }),
    ]);
    const [general] = await db
      .select()
      .from(teamspaces)
      .where(and(eq(teamspaces.workspaceId, ws.id), eq(teamspaces.isDefault, true)));
    expect(general).toBeDefined();
    expect(await findProvisionedPersonalWorkspace(db, user)).toMatchObject({ id: ws.id });

    // Idempotent: the second call answers with the same workspace.
    const again = await provisionPersonalWorkspace(db, { ownerId: user, name: 'Other' });
    expect(again).toMatchObject({ id: ws.id, name: 'Mine' });
  });

  it('repairs one left without its owner membership', async () => {
    // The state the old two-statement provisioning left behind when the
    // process died between the inserts: invisible in the list, for good.
    const user = `${scope}-orphan`;
    const orphan = await createPersonalWorkspaceIfAbsent(db, { ownerId: user, name: 'Orphan' });
    expect(orphan).not.toBeNull();
    expect(await findProvisionedPersonalWorkspace(db, user)).toBeNull();

    const repaired = await provisionPersonalWorkspace(db, { ownerId: user, name: 'Orphan' });

    expect(repaired.id).toBe(orphan?.id);
    expect(await ownerRows(repaired.id)).toEqual([
      expect.objectContaining({ userId: user, role: 'owner' }),
    ]);
  });

  it('settles a concurrent first provisioning on one workspace', async () => {
    const user = `${scope}-concurrent`;
    const [a, b] = await Promise.all([
      provisionPersonalWorkspace(db, { ownerId: user, name: 'A' }),
      provisionPersonalWorkspace(db, { ownerId: user, name: 'B' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await ownerRows(a.id)).toHaveLength(1);
  });

  it('cannot be archived, whoever writes', async () => {
    const ws = await provisionPersonalWorkspace(db, { ownerId: `${scope}-keep`, name: 'Keep' });
    const error = await archiveWorkspace(db, ws.id).then(
      () => null,
      (err: unknown) => err,
    );
    expect(isCheckViolation(error)).toBe(true);
    expect(constraintNameOf(error)).toBe('workspaces_personal_not_archived');
  });

  it('resets to empty, keeping its id, and touches nothing else', async () => {
    const user = `${scope}-reset`;
    const ws = await provisionPersonalWorkspace(db, { ownerId: user, name: 'Full' });
    await updateWorkspace(db, ws.id, { name: 'Renamed', avatar: 'oxy-file-avatar' });

    const parent = await createPage(db, {
      workspaceId: ws.id,
      ownerId: user,
      title: 'P',
      order: 0,
    });
    const child = await createPage(db, {
      workspaceId: ws.id,
      ownerId: user,
      parentId: parent.id,
      title: 'C',
      order: 0,
    });
    const database = await insertDatabase(db, {
      workspaceId: ws.id,
      name: 'Tasks',
      icon: null,
      cover: null,
      ownerId: user,
      isInline: false,
      parentPageId: parent.id,
      teamspaceId: null,
      archived: false,
      propertiesSchema: { properties: [{ id: 'name', name: 'Name', type: 'text' }] } as never,
    });
    await createPage(db, {
      workspaceId: ws.id,
      ownerId: user,
      databaseId: database.id,
      title: 'Row',
      order: 0,
    });
    await createComment(db, {
      workspaceId: ws.id,
      pageId: child.id,
      authorId: user,
      content: { segments: [{ type: 'text', text: 'hi' }], plainText: 'hi' } as never,
    });
    await db.insert(reminders).values({ userId: user, pageId: child.id, remindAt: new Date() });
    await createTeamspace(db, {
      workspaceId: ws.id,
      name: 'Side',
      privacy: 'open',
      createdBy: user,
    });
    await db.insert(notifications).values([
      { oxyUserId: user, type: 'reminder', title: 't', body: 'b', data: { workspaceId: ws.id } },
      { oxyUserId: user, type: 'mention', title: 't', body: 'b', data: { pageId: child.id } },
    ]);

    // A neighbour the reset must not reach: another workspace of the same user.
    const team = await createWorkspace(db, { name: 'Team', ownerId: user });
    const kept = await createPage(db, {
      workspaceId: team.id,
      ownerId: user,
      title: 'K',
      order: 0,
    });
    await db.insert(notifications).values({
      oxyUserId: user,
      type: 'mention',
      title: 't',
      body: 'b',
      data: { pageId: kept.id, workspaceId: team.id },
    });

    const removed = await resetPersonalWorkspace(db, ws, 'Fresh');

    expect(removed).toEqual({ pages: 3, databases: 1 });
    expect(await findWorkspaceRow(ws.id)).toMatchObject({ name: 'Fresh', avatar: null });
    expect(await db.select().from(pages).where(eq(pages.workspaceId, ws.id))).toEqual([]);
    expect(await db.select().from(databases).where(eq(databases.workspaceId, ws.id))).toEqual([]);
    expect(await db.select().from(comments).where(eq(comments.workspaceId, ws.id))).toEqual([]);
    expect(await db.select().from(reminders).where(eq(reminders.userId, user))).toEqual([]);
    const spaces = await db.select().from(teamspaces).where(eq(teamspaces.workspaceId, ws.id));
    expect(spaces).toEqual([expect.objectContaining({ isDefault: true, name: 'General' })]);
    const spaceMembers = await db
      .select()
      .from(teamspaceMembers)
      .where(
        inArray(
          teamspaceMembers.teamspaceId,
          spaces.map((t) => t.id),
        ),
      );
    expect(spaceMembers).toEqual([expect.objectContaining({ userId: user, role: 'owner' })]);
    expect(await ownerRows(ws.id)).toEqual([
      expect.objectContaining({ userId: user, role: 'owner' }),
    ]);
    const left = await db.select().from(notifications).where(eq(notifications.oxyUserId, user));
    expect(left.map((n) => (n.data as { pageId?: string }).pageId)).toEqual([kept.id]);

    expect(await db.select().from(pages).where(eq(pages.id, kept.id))).toHaveLength(1);
  });
});

async function findWorkspaceRow(id: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row;
}
