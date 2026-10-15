import { describe, expect, it } from 'vitest';
import type { WorkspaceRole } from '../../db/schema/workspaces.js';
import {
  type BaseRole,
  baseRole,
  effectivePageRole,
  rolesForPages,
  type TeamspaceStanding,
  type Viewer,
} from '../page-access.js';

// chain is the page first, then its ancestors.
const chain = (...links: [string, boolean][]) =>
  links.map(([id, restricted]) => ({ id, restricted }));

const member = (role: WorkspaceRole): BaseRole => ({ role, passesRestricted: false });
const admin: BaseRole = { role: 'admin', passesRestricted: true };
const none: BaseRole = { role: null, passesRestricted: false };

const viewer = (
  memberRole: WorkspaceRole | null,
  teamspaces: Record<string, TeamspaceStanding> = {},
  userId = 'me',
): Viewer => ({ userId, memberRole, teamspaces: new Map(Object.entries(teamspaces)) });

describe('baseRole', () => {
  const inTeam = (id: string) => ({ teamspaceId: id, ownerId: 'someone' });

  it('gives a teamspace member their workspace role, and an owner at least admin', () => {
    const v = viewer('editor', {
      t: { privacy: 'closed', role: 'member' },
      o: { privacy: 'closed', role: 'owner' },
    });
    expect(baseRole(v, inTeam('t')).role).toBe('editor');
    expect(baseRole(v, inTeam('o')).role).toBe('admin');
  });

  it('counts only the workspace role in the default teamspace', () => {
    const v = viewer('viewer', { g: { privacy: 'open', isDefault: true, role: 'owner' } });
    expect(baseRole(v, inTeam('g')).role).toBe('viewer');
  });

  it('opens an open teamspace to the workspace, and not a closed or private one', () => {
    const v = viewer('commenter', {
      open: { privacy: 'open', role: null },
      closed: { privacy: 'closed', role: null },
      hidden: { privacy: 'private', role: null },
    });
    expect(baseRole(v, inTeam('open')).role).toBe('commenter');
    expect(baseRole(v, inTeam('closed')).role).toBeNull();
    expect(baseRole(v, inTeam('hidden')).role).toBeNull();
  });

  it('lets workspace owners and admins into every teamspace, past restrictions', () => {
    const v = viewer('admin', { hidden: { privacy: 'private', role: null } });
    expect(baseRole(v, inTeam('hidden'))).toEqual(admin);
  });

  it('keeps a private tree to its owner — workspace admins included', () => {
    expect(baseRole(viewer('viewer'), { teamspaceId: null, ownerId: 'me' }).role).toBe('admin');
    expect(baseRole(viewer('owner'), { teamspaceId: null, ownerId: 'someone' }).role).toBeNull();
  });

  it('gives a guest nothing from where the page lives', () => {
    const v = viewer(null, { open: { privacy: 'open', role: null } });
    expect(baseRole(v, inTeam('open')).role).toBeNull();
    expect(baseRole(viewer(null), { teamspaceId: null, ownerId: 'me' }).role).toBeNull();
  });
});

describe('effectivePageRole', () => {
  it('gives the base role on open pages', () => {
    expect(
      effectivePageRole({
        base: member('editor'),
        chain: chain(['p', false], ['root', false]),
        grants: [],
      }),
    ).toBe('editor');
  });

  it('closes a restricted page, and everything under it, without a grant', () => {
    expect(
      effectivePageRole({ base: member('editor'), chain: chain(['p', true]), grants: [] }),
    ).toBeNull();
    expect(
      effectivePageRole({
        base: member('editor'),
        chain: chain(['child', false], ['p', true]),
        grants: [],
      }),
    ).toBeNull();
  });

  it('lets workspace admins in a teamspace past restricted pages', () => {
    expect(effectivePageRole({ base: admin, chain: chain(['p', true]), grants: [] })).toBe('admin');
  });

  it('lets a grant on the page or an ancestor reach down, and takes the strongest', () => {
    const grants = [
      { pageId: 'root', role: 'viewer' as const },
      { pageId: 'p', role: 'commenter' as const },
    ];
    expect(
      effectivePageRole({
        base: none,
        chain: chain(['child', false], ['p', false], ['root', false]),
        grants,
      }),
    ).toBe('commenter');
    // A grant raises someone above their base role.
    expect(
      effectivePageRole({
        base: member('viewer'),
        chain: chain(['p', false]),
        grants: [{ pageId: 'p', role: 'editor' }],
      }),
    ).toBe('editor');
  });

  it('cuts off grants from above the nearest restricted page', () => {
    const grants = [{ pageId: 'root', role: 'editor' as const }];
    expect(
      effectivePageRole({ base: none, chain: chain(['p', true], ['root', false]), grants }),
    ).toBeNull();
    expect(
      effectivePageRole({
        base: none,
        chain: chain(['child', false], ['p', true], ['root', false]),
        grants: [...grants, { pageId: 'p', role: 'viewer' }],
      }),
    ).toBe('viewer');
  });

  it('gives no access with neither a base role nor a grant', () => {
    expect(effectivePageRole({ base: none, chain: chain(['p', false]), grants: [] })).toBeNull();
  });
});

describe('rolesForPages', () => {
  const page = (
    id: string,
    parentId: string | null,
    restricted = false,
    home: { teamspaceId: string | null; ownerId: string } = { teamspaceId: 't', ownerId: 'x' },
  ) => ({ id, parentId, restricted, ...home });

  it('applies the rule to a whole workspace list, each tree from where it lives', () => {
    const pages = [
      page('root', null),
      page('secret', 'root', true),
      page('inside', 'secret'),
      page('open', 'root'),
      page('mine', null, false, { teamspaceId: null, ownerId: 'me' }),
      page('mine-child', 'mine'),
      page('theirs', null, false, { teamspaceId: null, ownerId: 'them' }),
    ];
    const v = viewer('editor', { t: { privacy: 'open', role: null } });
    expect([...rolesForPages(pages, v, [])]).toEqual([
      ['root', 'editor'],
      ['open', 'editor'],
      ['mine', 'admin'],
      ['mine-child', 'admin'],
    ]);
    expect(rolesForPages(pages, v, [{ pageId: 'secret', role: 'viewer' }]).get('inside')).toBe(
      'viewer',
    );
    expect(rolesForPages(pages, v, [{ pageId: 'theirs', role: 'commenter' }]).get('theirs')).toBe(
      'commenter',
    );
  });

  it('places the rows of a database in no page where the database lives', () => {
    const pages = [{ ...page('row', null), databaseId: 'db' }];
    const homes = new Map([['db', { parentPageId: null, teamspaceId: null, ownerId: 'me' }]]);
    expect(rolesForPages(pages, viewer('viewer'), [], homes).get('row')).toBe('admin');
    expect(rolesForPages(pages, viewer('owner', {}, 'other'), [], homes).has('row')).toBe(false);
  });
});
