import { buildPageTree } from '../page-tree';
import type { Page } from '../types/pages';

const page = (id: string, parentId: string | null, order = 0): Page => ({
  fullWidth: false,
  smallText: false,
  font: 'default',
  locked: false,
  id,
  parentId,
  order,
  teamspaceId: null,
  workspaceId: 'guest-workspace',
  title: id,
  ownerId: 'owner',
  icon: null,
  cover: null,
  coverPosition: 50,
  archived: false,
  favorited: false,
  publishedAt: null,
  publishSlug: null,
  publishIndexing: false,
  restricted: false,
  template: false,
  databaseId: null,
  properties: {},
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
});

describe('shared page tree', () => {
  it('excludes templates even when a shared-page response includes them', () => {
    const template = { ...page('template', null), template: true };
    const tree = buildPageTree([template, page('regular', null)]);
    expect(tree.map((node) => node.page.id)).toEqual(['regular']);
  });

  it('promotes pages with inaccessible parents and nests only accessible descendants', () => {
    const pages = [
      page('grandchild', 'child'),
      page('shared', 'private-parent'),
      page('child', 'shared'),
    ];
    const tree = buildPageTree(pages);
    expect(tree.map((node) => node.page.id)).toEqual(['shared']);
    expect(tree[0].children[0].page.id).toBe('child');
    expect(tree[0].children[0].children[0].page.id).toBe('grandchild');
  });

  it('sorts sibling roots and descendants without mutating the response', () => {
    const pages = [
      page('root-b', null, 2),
      page('child-b', 'root-a', 2),
      page('root-a', 'missing', 1),
      page('child-a', 'root-a', 1),
    ];
    const original = [...pages];
    const tree = buildPageTree(pages);
    expect(tree.map((node) => node.page.id)).toEqual(['root-a', 'root-b']);
    expect(tree[0].children.map((node) => node.page.id)).toEqual(['child-a', 'child-b']);
    expect(pages).toEqual(original);
  });

  it('uses recent updates to break order ties and accepts an empty response', () => {
    expect(buildPageTree([])).toEqual([]);
    const older = page('older', null);
    const newer = { ...page('newer', null), updatedAt: '2026-10-16T00:00:00Z' };
    expect(buildPageTree([older, newer]).map((node) => node.page.id)).toEqual(['newer', 'older']);
  });
});
