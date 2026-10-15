import { groupSidebar } from '../sidebar-groups';
import type { Page } from '../types/pages';
import type { Database } from '../types/databases';
import type { Teamspace } from '../hooks/use-teamspaces';

function page(id: string, patch: Partial<Page> = {}): Page {
  return {
    id,
    workspaceId: 'w',
    parentId: null,
    teamspaceId: null,
    ownerId: 'me',
    title: id,
    icon: null,
    cover: null,
    coverPosition: 50,
    fullWidth: false,
    smallText: false,
    font: 'default',
    mode: 'document',
    locked: false,
    publishedAt: null,
    publishSlug: null,
    publishIndexing: false,
    restricted: false,
    template: false,
    archived: false,
    favorited: false,
    order: 0,
    createdAt: '',
    updatedAt: '',
    databaseId: null,
    properties: {},
    ...patch,
  };
}
function space(id: string, patch: Partial<Teamspace> = {}): Teamspace {
  return {
    id,
    workspaceId: 'w',
    name: id,
    icon: null,
    description: '',
    privacy: 'open',
    isDefault: false,
    archived: false,
    role: 'member',
    createdAt: '',
    ...patch,
  };
}
function database(id: string, patch: Partial<Database> = {}): Database {
  return {
    id,
    workspaceId: 'w',
    teamspaceId: null,
    ownerId: 'me',
    name: id,
    icon: null,
    cover: null,
    schema: { properties: [] },
    isInline: false,
    parentPageId: null,
    archived: false,
    createdAt: '',
    updatedAt: '',
    ...patch,
  };
}

it('groups by visible tree root, never by the creator or subpage placement', () => {
  const result = groupSidebar(
    [
      page('team', { teamspaceId: 'default', ownerId: 'other' }),
      page('team-child', { parentId: 'team', ownerId: 'me' }),
      page('mine'),
      page('mine-child', { parentId: 'mine', ownerId: 'other' }),
      page('shared-private', { ownerId: 'other', sharedWithMe: true }),
      page('shared-child', { parentId: 'shared-private', sharedWithMe: true }),
      page('orphan', { parentId: 'inaccessible', teamspaceId: 'default', sharedWithMe: true }),
      page('orphan-child', { parentId: 'orphan', sharedWithMe: true }),
      // Open to me by role in a teamspace I have not joined: not in my sidebar.
      page('open-outsider', { teamspaceId: 'unjoined' }),
      page('shared-in-unjoined', { teamspaceId: 'unjoined', sharedWithMe: true }),
      page('template', { template: true }),
      page('archived', { archived: true }),
      page('row', { databaseId: 'db' }),
      page('archived-team-page', { teamspaceId: 'old' }),
      page('archived-team-child', { parentId: 'archived-team-page' }),
    ],
    [],
    [
      space('z'),
      space('default', { isDefault: true }),
      space('unjoined', { role: null }),
      space('old', { archived: true }),
    ],
    'me',
  );
  expect(result.teamspaces.map((g) => g.teamspace.id)).toEqual(['default', 'z']);
  expect(result.teamspaces[0].pages.map((p) => p.id)).toEqual(['team', 'team-child']);
  expect(result.privatePages.map((p) => p.id)).toEqual(['mine', 'mine-child']);
  expect(result.shared.map((p) => p.id)).toEqual([
    'shared-private',
    'shared-child',
    'orphan',
    'orphan-child',
    'shared-in-unjoined',
  ]);
});

it('lists only standalone databases in their teamspace or their owner’s private area', () => {
  const result = groupSidebar(
    [],
    [
      database('team', { teamspaceId: 't', ownerId: 'other' }),
      database('mine'),
      database('other', { ownerId: 'other' }),
      database('inline', { parentPageId: 'p' }),
      database('archived', { archived: true }),
    ],
    [space('t')],
    'me',
  );
  expect(result.teamspaces[0].databases.map((d) => d.id)).toEqual(['team']);
  expect(result.privateDatabases.map((d) => d.id)).toEqual(['mine']);
});
