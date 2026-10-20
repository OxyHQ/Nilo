import { planSectionDrop, planSidebarDrop } from '../sidebar-drop';
import type { Page } from '../types/pages';

const page = (id: string, order: number, patch: Partial<Page> = {}) =>
  ({
    id,
    order,
    parentId: null,
    template: false,
    updatedAt: '2026-10-19T00:00:00Z',
    ...patch,
  }) as Page;

describe('dropping a page in the sidebar', () => {
  const tree = [page('a', 1), page('b', 2), page('c', 3), page('child', 1, { parentId: 'a' })];

  it('lands between its new neighbours, never on one of them', () => {
    // `target ± 0.5` put it on 2.5 — and the next drop on the same spot.
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'c', targetId: 'b', position: 'before' }),
    ).toEqual([{ id: 'c', patch: { order: 1.5, parentId: null } }]);
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'a', targetId: 'b', position: 'after' }),
    ).toEqual([{ id: 'a', patch: { order: 2.5, parentId: null } }]);
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'c', targetId: 'a', position: 'before' }),
    ).toEqual([{ id: 'c', patch: { order: 0, parentId: null } }]);
  });

  it('goes last among the children of the page it is dropped into', () => {
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'c', targetId: 'a', position: 'inside' }),
    ).toEqual([{ id: 'c', patch: { order: 2, parentId: 'a' } }]);
  });

  it('renumbers siblings that leave no room, in the order the sidebar shows them', () => {
    const tied = [
      page('x', 1, { updatedAt: '2026-10-19T00:00:02Z' }),
      page('y', 1, { updatedAt: '2026-10-19T00:00:01Z' }),
      page('z', 5),
    ];
    // Shown x, y (the latest update first); dropped between them.
    expect(
      planSidebarDrop({ pages: tied, sourceId: 'z', targetId: 'y', position: 'before' }),
    ).toEqual([
      { id: 'y', patch: { order: 2 } },
      { id: 'z', patch: { order: 1.5, parentId: null } },
    ]);
  });

  it('moves a page dropped at the top of another section to that section', () => {
    // `elsewhere` is not in this tree: it was dragged from another section.
    expect(
      planSidebarDrop({
        pages: tree,
        sourceId: 'elsewhere',
        targetId: 'c',
        position: 'after',
        place: { teamspaceId: 'team' },
      }),
    ).toEqual([{ id: 'elsewhere', patch: { order: 4, parentId: null, teamspaceId: 'team' } }]);
    expect(
      planSidebarDrop({
        pages: tree,
        sourceId: 'elsewhere',
        targetId: 'a',
        position: 'before',
        place: { teamspaceId: null },
      }),
    ).toEqual([{ id: 'elsewhere', patch: { order: 0, parentId: null, teamspaceId: null } }]);
    // Below a page it lives where that page's tree does.
    expect(
      planSidebarDrop({
        pages: tree,
        sourceId: 'elsewhere',
        targetId: 'child',
        position: 'after',
        place: { teamspaceId: 'team' },
      }),
    ).toEqual([{ id: 'elsewhere', patch: { order: 2, parentId: 'a' } }]);
  });

  it('refuses a drop onto itself or into its own subtree', () => {
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'a', targetId: 'a', position: 'inside' }),
    ).toBeNull();
    expect(
      planSidebarDrop({ pages: tree, sourceId: 'a', targetId: 'child', position: 'inside' }),
    ).toBeNull();
  });
});

describe('dropping a page on a section or a teamspace', () => {
  it('goes last at the top level, moving into the place', () => {
    const tree = [page('a', 1), page('b', 2), page('child', 1, { parentId: 'a' })];
    expect(
      planSectionDrop({ pages: tree, sourceId: 'child', place: { teamspaceId: 't' } }),
    ).toEqual([{ id: 'child', patch: { order: 3, parentId: null, teamspaceId: 't' } }]);
  });

  it('starts an empty place at the first order', () => {
    expect(planSectionDrop({ pages: [], sourceId: 'x', place: { teamspaceId: null } })).toEqual([
      { id: 'x', patch: { order: 1, parentId: null, teamspaceId: null } },
    ]);
  });

  it('never counts the page itself among the rows it goes after', () => {
    const tree = [page('a', 1), page('b', 2)];
    expect(planSectionDrop({ pages: tree, sourceId: 'b', place: { teamspaceId: null } })).toEqual([
      { id: 'b', patch: { order: 2, parentId: null, teamspaceId: null } },
    ]);
  });
});
