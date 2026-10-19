import { greetingFor, recentlyVisited } from '../home';
import type { Page } from '../types/pages';

const page = (id: string, patch: Partial<Page> = {}) =>
  ({ id, title: id, archived: false, template: false, databaseId: null, ...patch }) as Page;

describe('Home', () => {
  it('lists the pages visited last, most recent first', () => {
    const pages = [page('a'), page('b'), page('c')];
    expect(recentlyVisited(pages, ['c', 'a', 'b']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves out database rows, templates, the trash and pages gone', () => {
    const pages = [
      page('doc'),
      page('row', { databaseId: 'db' }),
      page('template', { template: true }),
      page('trashed', { archived: true }),
    ];
    const ids = ['row', 'template', 'gone', 'trashed', 'doc'];
    expect(recentlyVisited(pages, ids).map((p) => p.id)).toEqual(['doc']);
  });

  it('stops at its limit', () => {
    const pages = ['a', 'b', 'c'].map((id) => page(id));
    expect(recentlyVisited(pages, ['a', 'b', 'c'], 2)).toHaveLength(2);
  });

  it('greets for the time of day', () => {
    const at = (hour: number) => greetingFor(new Date(2026, 9, 19, hour));
    expect([at(4), at(5), at(11), at(12), at(17), at(18), at(23)]).toEqual([
      'evening',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
  });
});
