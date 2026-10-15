import { describe, expect, it } from 'vitest';
import { effectivePageRole, rolesForPages } from '../page-access.js';

// chain is the page first, then its ancestors.
const chain = (...links: [string, boolean][]) =>
  links.map(([id, restricted]) => ({ id, restricted }));

describe('effectivePageRole', () => {
  it('gives members their workspace role on open pages', () => {
    expect(
      effectivePageRole({
        memberRole: 'editor',
        chain: chain(['p', false], ['root', false]),
        grants: [],
      }),
    ).toBe('editor');
  });

  it('closes a restricted page, and everything under it, to members without a grant', () => {
    expect(
      effectivePageRole({ memberRole: 'editor', chain: chain(['p', true]), grants: [] }),
    ).toBeNull();
    expect(
      effectivePageRole({
        memberRole: 'editor',
        chain: chain(['child', false], ['p', true]),
        grants: [],
      }),
    ).toBeNull();
  });

  it('keeps owners and admins everywhere', () => {
    expect(effectivePageRole({ memberRole: 'admin', chain: chain(['p', true]), grants: [] })).toBe(
      'admin',
    );
    expect(effectivePageRole({ memberRole: 'owner', chain: chain(['p', true]), grants: [] })).toBe(
      'owner',
    );
  });

  it('lets a grant on the page or an ancestor reach down, and takes the strongest', () => {
    const grants = [
      { pageId: 'root', role: 'viewer' as const },
      { pageId: 'p', role: 'commenter' as const },
    ];
    expect(
      effectivePageRole({
        memberRole: null,
        chain: chain(['child', false], ['p', false], ['root', false]),
        grants,
      }),
    ).toBe('commenter');
    // A grant raises a member above their workspace role.
    expect(
      effectivePageRole({
        memberRole: 'viewer',
        chain: chain(['p', false]),
        grants: [{ pageId: 'p', role: 'editor' }],
      }),
    ).toBe('editor');
  });

  it('cuts off grants from above the nearest restricted page', () => {
    const grants = [{ pageId: 'root', role: 'editor' as const }];
    expect(
      effectivePageRole({ memberRole: null, chain: chain(['p', true], ['root', false]), grants }),
    ).toBeNull();
    expect(
      effectivePageRole({
        memberRole: null,
        chain: chain(['child', false], ['p', true], ['root', false]),
        grants: [...grants, { pageId: 'p', role: 'viewer' }],
      }),
    ).toBe('viewer');
  });

  it('gives no access to someone with neither membership nor grant', () => {
    expect(
      effectivePageRole({ memberRole: null, chain: chain(['p', false]), grants: [] }),
    ).toBeNull();
  });
});

describe('rolesForPages', () => {
  it('applies the rule to a whole workspace list', () => {
    const pages = [
      { id: 'root', parentId: null, restricted: false },
      { id: 'secret', parentId: 'root', restricted: true },
      { id: 'inside', parentId: 'secret', restricted: false },
      { id: 'open', parentId: 'root', restricted: false },
    ];
    expect([...rolesForPages(pages, 'editor', [])]).toEqual([
      ['root', 'editor'],
      ['open', 'editor'],
    ]);
    expect(
      rolesForPages(pages, 'editor', [{ pageId: 'secret', role: 'viewer' }]).get('inside'),
    ).toBe('viewer');
  });
});
