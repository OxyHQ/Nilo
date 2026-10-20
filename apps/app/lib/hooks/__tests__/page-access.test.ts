import {
  PAGE_GRANT_ROLES,
  canAssignPageRole,
  canManagePageGrant,
  canRestrictPage,
  pageContentReadOnly,
} from '../page-access';
import type { PageGrant, PageRole } from '../use-page-permissions';

const grant: PageGrant = {
  userId: 'guest',
  user: null,
  role: 'editor',
  grantedBy: 'owner',
  inheritedFrom: null,
  viaShareLink: false,
  createdAt: '2026-10-15T00:00:00Z',
};

describe('page sharing capabilities', () => {
  it.each<[PageRole, string[]]>([
    ['viewer', []],
    ['commenter', []],
    ['editor', ['viewer', 'commenter', 'editor']],
    ['admin', ['viewer', 'commenter', 'editor', 'admin']],
    ['owner', ['viewer', 'commenter', 'editor', 'admin']],
  ])('%s can only grant roles within their access', (caller, expected) => {
    expect(PAGE_GRANT_ROLES.filter((role) => canAssignPageRole(caller, role))).toEqual(expected);
  });

  it('prevents editors from changing a stronger grant', () => {
    expect(canManagePageGrant('editor', { ...grant, role: 'admin' })).toBe(false);
    expect(canManagePageGrant('admin', { ...grant, role: 'admin' })).toBe(true);
  });

  it('requires inherited grants to be managed on their source page, even by owners', () => {
    expect(canManagePageGrant('owner', { ...grant, inheritedFrom: 'parent' })).toBe(false);
    expect(canManagePageGrant('editor', grant)).toBe(true);
  });

  it('reserves restriction changes for full access or the creator', () => {
    expect(canRestrictPage('editor', 'creator', 'another')).toBe(false);
    expect(canRestrictPage('editor', 'creator', 'creator')).toBe(true);
    expect(canRestrictPage('viewer', 'creator', 'creator')).toBe(true);
    expect(canRestrictPage('admin', 'creator', 'another')).toBe(true);
    expect(canRestrictPage('owner', 'creator', 'another')).toBe(true);
    expect(canRestrictPage('viewer', 'creator', undefined)).toBe(false);
  });

  it('reads the content of a locked or trashed page, and below editor', () => {
    const page = { locked: false, archived: false };
    expect(pageContentReadOnly(page, 'editor')).toBe(false);
    expect(pageContentReadOnly(page, 'commenter')).toBe(true);
    expect(pageContentReadOnly(page, undefined)).toBe(true);
    expect(pageContentReadOnly({ ...page, locked: true }, 'owner')).toBe(true);
    expect(pageContentReadOnly({ ...page, archived: true }, 'owner')).toBe(true);
  });
});
