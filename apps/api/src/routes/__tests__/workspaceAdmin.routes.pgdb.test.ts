/**
 * Administering a workspace through the real routes: invitations waiting for
 * someone without an Oxy account, the join link, handing the workspace to
 * another member, and its guests.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { teamspaceMembers, teamspaces } from '../../db/schema/teamspaces.js';
import { workspaceInvites, workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { createPage } from '../../repositories/pages.js';

const scope = testScope('ws-admin');
const OWNER = `${scope}-owner`;
const ADMIN = `${scope}-admin`;
const EDITOR = `${scope}-editor`;
const NEWCOMER = `${scope}-newcomer`;
const GUEST = `${scope}-guest`;
const STRANGER = `${scope}-stranger`;

/** The Oxy accounts this file knows: id → email. The newcomer has none yet. */
const accounts = new Map<string, string>([
  [OWNER, `${scope}-owner@example.test`],
  [ADMIN, `${scope}-admin@example.test`],
  [EDITOR, `${scope}-editor@example.test`],
  [GUEST, `${scope}-guest@example.test`],
  [STRANGER, `${scope}-stranger@example.test`],
]);
const NEWCOMER_EMAIL = `${scope}-New.Comer@Example.test`;

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = { id };
    next();
  },
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: {
      get: async (id: string) => ({ id, username: id, email: accounts.get(id) }),
      getMany: async (ids: string[]) =>
        ids.map((id) => ({ id, username: id, email: accounts.get(id) ?? null })),
      search: async (email: string) => ({
        data: [...accounts.entries()]
          .filter(([, address]) => address.toLowerCase() === email.toLowerCase())
          .map(([id, address]) => ({ id, email: address })),
      }),
    },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: workspacesRouter } = await import('../workspaces.js');
const { default: inviteLinksRouter } = await import('../invite-links.js');

let db: TestDatabase;
let server: Server;
let base: string;
let previousUrl: string | undefined;
let previousPublicUrl: string | undefined;

async function api(user: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user ? { 'x-test-user': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

type Workspace = { id: string; isPersonal: boolean; role: string | null; ownerId: string };

async function team(name: string): Promise<string> {
  const created = await api(OWNER, 'POST', '/workspaces', { name });
  expect(created.status).toBe(201);
  const id = (created.json.workspace as Workspace).id;
  for (const [user, role] of [
    [ADMIN, 'admin'],
    [EDITOR, 'editor'],
  ] as const) {
    const res = await api(OWNER, 'POST', `/workspaces/${id}/members`, {
      email: accounts.get(user),
      role,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
  }
  return id;
}

async function roleOf(workspaceId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  previousPublicUrl = process.env.OXYNILO_PUBLIC_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
  const app = express();
  app.use(express.json());
  app.use('/workspaces', workspacesRouter);
  app.use(inviteLinksRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
  process.env.OXYNILO_PUBLIC_URL = previousPublicUrl;
});

describe('inviting an email that is not an Oxy account yet', () => {
  it('records a pending invitation instead of failing', async () => {
    const id = await team('Pending');
    const res = await api(ADMIN, 'POST', `/workspaces/${id}/members`, {
      email: NEWCOMER_EMAIL,
      role: 'commenter',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json.pending).toBe(true);
    expect(res.json.invite).toMatchObject({
      email: NEWCOMER_EMAIL.toLowerCase(),
      role: 'commenter',
      invitedBy: ADMIN,
      expired: false,
    });

    // Inviting again renews the one invitation rather than adding another.
    await api(ADMIN, 'POST', `/workspaces/${id}/members`, {
      email: NEWCOMER_EMAIL,
      role: 'editor',
    });
    const listed = await api(OWNER, 'GET', `/workspaces/${id}/invites`);
    expect(listed.status).toBe(200);
    expect(listed.json.invites).toEqual([
      expect.objectContaining({ email: NEWCOMER_EMAIL.toLowerCase(), role: 'editor' }),
    ]);
  });

  it('is listed and revoked by admins only', async () => {
    const id = await team('Revoke');
    const created = await api(OWNER, 'POST', `/workspaces/${id}/members`, {
      email: `${scope}-someone@example.test`,
      role: 'viewer',
    });
    const inviteId = (created.json.invite as { id: string }).id;

    expect((await api(EDITOR, 'GET', `/workspaces/${id}/invites`)).status).toBe(403);
    expect((await api(EDITOR, 'DELETE', `/workspaces/${id}/invites/${inviteId}`)).status).toBe(403);
    expect((await api(ADMIN, 'DELETE', `/workspaces/${id}/invites/${inviteId}`)).status).toBe(200);
    expect((await api(ADMIN, 'DELETE', `/workspaces/${id}/invites/${inviteId}`)).status).toBe(404);
    expect((await api(OWNER, 'GET', `/workspaces/${id}/invites`)).json.invites).toEqual([]);
  });

  it('becomes a membership when someone with that email lists their workspaces', async () => {
    const id = await team('Accepted');
    await api(OWNER, 'POST', `/workspaces/${id}/members`, {
      email: NEWCOMER_EMAIL,
      role: 'editor',
    });
    // Still nobody: the invitation waits.
    expect(await roleOf(id, NEWCOMER)).toBeNull();

    // The newcomer signs up to Oxy with that email (any letter case).
    accounts.set(NEWCOMER, NEWCOMER_EMAIL.toUpperCase());
    const list = await api(NEWCOMER, 'GET', '/workspaces');
    expect(list.status).toBe(200);
    const listed = list.json.workspaces as Workspace[];
    expect(listed.find((w) => w.id === id)).toMatchObject({ role: 'editor' });
    expect(await roleOf(id, NEWCOMER)).toBe('editor');

    // In the default teamspace like every member, and the invitation is spent.
    const [general] = await db
      .select({ id: teamspaces.id })
      .from(teamspaces)
      .where(and(eq(teamspaces.workspaceId, id), eq(teamspaces.isDefault, true)));
    const joined = await db
      .select()
      .from(teamspaceMembers)
      .where(
        and(eq(teamspaceMembers.teamspaceId, general.id), eq(teamspaceMembers.userId, NEWCOMER)),
      );
    expect(joined).toHaveLength(1);
    expect((await api(OWNER, 'GET', `/workspaces/${id}/invites`)).json.invites).toEqual([]);
    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, id));
    expect(invite.acceptedAt).not.toBeNull();
    accounts.delete(NEWCOMER);
  });

  it('expires, and an expired invitation is never accepted', async () => {
    const id = await team('Expired');
    const email = `${scope}-late@example.test`;
    await api(OWNER, 'POST', `/workspaces/${id}/members`, { email, role: 'viewer' });
    await db
      .update(workspaceInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceInvites.workspaceId, id));
    expect((await api(OWNER, 'GET', `/workspaces/${id}/invites`)).json.invites).toEqual([
      expect.objectContaining({ email, expired: true }),
    ]);

    const LATE = `${scope}-late`;
    accounts.set(LATE, email);
    await api(LATE, 'GET', '/workspaces');
    expect(await roleOf(id, LATE)).toBeNull();
    accounts.delete(LATE);
  });

  it('is refused on a personal workspace', async () => {
    const personal = await api(OWNER, 'GET', '/workspaces/personal');
    const id = (personal.json.workspace as Workspace).id;
    const res = await api(OWNER, 'POST', `/workspaces/${id}/members`, {
      email: NEWCOMER_EMAIL,
      role: 'viewer',
    });
    expect(res.status).toBe(400);
  });
});

describe('the workspace join link', () => {
  it('is made, read and changed by admins, and lets a signed-in person join', async () => {
    const id = await team('Link');
    expect((await api(EDITOR, 'POST', `/workspaces/${id}/invite-link`, {})).status).toBe(403);
    expect((await api(ADMIN, 'GET', `/workspaces/${id}/invite-link`)).json.link).toBeNull();

    const made = await api(ADMIN, 'POST', `/workspaces/${id}/invite-link`, { role: 'viewer' });
    expect(made.status).toBe(201);
    const link = made.json.link as { token: string; url: string; role: string };
    expect(link.url).toBe(`https://nilo.example.test/join/${link.token}`);
    expect(link.role).toBe('viewer');

    const preview = await api(null, 'GET', `/invite-links/${link.token}`);
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ workspace: { id, name: 'Link' }, role: 'viewer' });

    expect((await api(null, 'POST', `/invite-links/${link.token}/join`)).status).toBe(401);
    const joined = await api(STRANGER, 'POST', `/invite-links/${link.token}/join`);
    expect(joined.status).toBe(201);
    expect(joined.json).toEqual({ workspaceId: id, role: 'viewer', joined: true });
    expect(await roleOf(id, STRANGER)).toBe('viewer');

    // A member opening it again keeps the role they have.
    const again = await api(EDITOR, 'POST', `/invite-links/${link.token}/join`);
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ workspaceId: id, role: 'editor', joined: false });

    // Changing its role keeps the link.
    const changed = await api(ADMIN, 'PATCH', `/workspaces/${id}/invite-link`, { role: 'editor' });
    expect(changed.json.link).toMatchObject({ token: link.token, role: 'editor' });
  });

  it('stops working when regenerated or disabled', async () => {
    const id = await team('Rotate');
    const first = (await api(OWNER, 'POST', `/workspaces/${id}/invite-link`, {})).json.link as {
      token: string;
      role: string;
    };
    expect(first.role).toBe('editor');
    const second = (await api(OWNER, 'POST', `/workspaces/${id}/invite-link`, {})).json.link as {
      token: string;
    };
    expect(second.token).not.toBe(first.token);
    expect((await api(STRANGER, 'POST', `/invite-links/${first.token}/join`)).status).toBe(410);
    expect((await api(null, 'GET', `/invite-links/${first.token}`)).status).toBe(410);

    expect((await api(OWNER, 'DELETE', `/workspaces/${id}/invite-link`)).status).toBe(200);
    expect((await api(OWNER, 'GET', `/workspaces/${id}/invite-link`)).json.link).toBeNull();
    expect((await api(STRANGER, 'POST', `/invite-links/${second.token}/join`)).status).toBe(410);
    expect(
      (await api(OWNER, 'PATCH', `/workspaces/${id}/invite-link`, { role: 'viewer' })).status,
    ).toBe(404);
    expect(await roleOf(id, STRANGER)).toBeNull();
    expect((await api(null, 'GET', '/invite-links/never-a-token-at-all')).status).toBe(404);
  });

  it('never gives more than editing, and never on a personal workspace', async () => {
    const id = await team('Ceiling');
    expect(
      (await api(OWNER, 'POST', `/workspaces/${id}/invite-link`, { role: 'admin' })).status,
    ).toBe(400);
    const personal = (await api(OWNER, 'GET', '/workspaces/personal')).json.workspace as Workspace;
    expect((await api(OWNER, 'POST', `/workspaces/${personal.id}/invite-link`, {})).status).toBe(
      400,
    );
  });
});

describe('transferring ownership', () => {
  it('makes another member the owner and the previous one an admin', async () => {
    const id = await team('Transfer');
    expect(
      (await api(ADMIN, 'POST', `/workspaces/${id}/transfer`, { userId: EDITOR })).status,
    ).toBe(403);
    expect(
      (await api(OWNER, 'POST', `/workspaces/${id}/transfer`, { userId: STRANGER })).status,
    ).toBe(404);
    expect((await api(OWNER, 'POST', `/workspaces/${id}/transfer`, { userId: OWNER })).status).toBe(
      400,
    );

    const res = await api(OWNER, 'POST', `/workspaces/${id}/transfer`, { userId: EDITOR });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(await roleOf(id, EDITOR)).toBe('owner');
    expect(await roleOf(id, OWNER)).toBe('admin');
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    expect(row.ownerId).toBe(EDITOR);
    const owners = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.role, 'owner')));
    expect(owners).toEqual([{ userId: EDITOR }]);

    // The previous owner no longer can; the new one cannot be removed or demoted.
    expect((await api(OWNER, 'POST', `/workspaces/${id}/transfer`, { userId: ADMIN })).status).toBe(
      403,
    );
    const removed = await api(OWNER, 'DELETE', `/workspaces/${id}/members/${EDITOR}`);
    expect(removed.status).toBe(400);
    expect(removed.json.code).toBe('OWNER_CANNOT_LEAVE');
    expect(
      (await api(OWNER, 'PATCH', `/workspaces/${id}/members/${EDITOR}`, { role: 'viewer' })).status,
    ).toBe(400);
    // Nor can the owner leave without handing it over first.
    expect((await api(EDITOR, 'DELETE', `/workspaces/${id}/members/${EDITOR}`)).status).toBe(400);
    // The previous owner, now an admin, can leave.
    expect((await api(OWNER, 'DELETE', `/workspaces/${id}/members/${OWNER}`)).status).toBe(200);
    await db.delete(workspaces).where(eq(workspaces.id, id));
  });

  it('is refused for a personal workspace', async () => {
    const personal = (await api(OWNER, 'GET', '/workspaces/personal')).json.workspace as Workspace;
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: personal.id, userId: STRANGER, role: 'admin' });
    const res = await api(OWNER, 'POST', `/workspaces/${personal.id}/transfer`, {
      userId: STRANGER,
    });
    expect(res.status).toBe(400);
    await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, personal.id), eq(workspaceMembers.userId, STRANGER)),
      );
  });
});

describe('guests', () => {
  it('lists the people pages are shared with who are not members, and removes them', async () => {
    const id = await team('Guests');
    const plan = await createPage(db, { workspaceId: id, ownerId: OWNER, title: 'Plan', order: 0 });
    const notes = await createPage(db, {
      workspaceId: id,
      ownerId: OWNER,
      title: 'Notes',
      order: 1,
    });
    await db.insert(pagePermissions).values([
      { pageId: plan.id, userId: GUEST, role: 'commenter', grantedBy: OWNER },
      { pageId: notes.id, userId: GUEST, role: 'viewer', grantedBy: ADMIN },
      // A member a page is shared with is not a guest.
      { pageId: notes.id, userId: EDITOR, role: 'editor', grantedBy: OWNER },
    ]);

    expect((await api(EDITOR, 'GET', `/workspaces/${id}/guests`)).status).toBe(403);
    const listed = await api(ADMIN, 'GET', `/workspaces/${id}/guests`);
    expect(listed.status).toBe(200);
    const guests = listed.json.guests as {
      userId: string;
      user: { email: string } | null;
      pages: { pageId: string; title: string; role: string }[];
    }[];
    expect(guests.map((g) => g.userId)).toEqual([GUEST]);
    expect(guests[0].user?.email).toBe(accounts.get(GUEST));
    expect(guests[0].pages.map((p) => [p.title, p.role]).sort()).toEqual([
      ['Notes', 'viewer'],
      ['Plan', 'commenter'],
    ]);

    expect((await api(ADMIN, 'DELETE', `/workspaces/${id}/guests/${EDITOR}`)).status).toBe(400);
    expect((await api(EDITOR, 'DELETE', `/workspaces/${id}/guests/${GUEST}`)).status).toBe(403);
    const removed = await api(ADMIN, 'DELETE', `/workspaces/${id}/guests/${GUEST}`);
    expect(removed.json).toEqual({ success: true, removed: 2 });
    expect((await api(ADMIN, 'GET', `/workspaces/${id}/guests`)).json.guests).toEqual([]);
    expect((await api(ADMIN, 'DELETE', `/workspaces/${id}/guests/${GUEST}`)).status).toBe(404);
    // The member's grant is theirs to keep.
    const kept = await db.select().from(pagePermissions).where(eq(pagePermissions.userId, EDITOR));
    expect(kept.map((g) => g.pageId)).toContain(notes.id);
  });
});
