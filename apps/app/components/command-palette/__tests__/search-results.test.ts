import { mapSearchResults, searchPageHref, snippetRuns } from '../search-results';
import type { SearchResult } from '@/lib/types/search';

const result = (id: string, title: string, matchedTitle: boolean): SearchResult => ({
  page: { id, title, icon: '📄', parentId: 'parent' },
  path: ['Workspace', 'Projects'],
  matchedTitle,
  blockId: matchedTitle ? null : 'block-1',
  snippet: matchedTitle ? [] : [{ text: 'planificación semanal', match: true }],
});

describe('server search results', () => {
  it('preserves server ranking and body matches even when the title does not match', () => {
    const results = [result('title', 'Weekly plan', true), result('body', 'Notes', false)];
    const items = mapSearchResults(results, 'Untitled');
    expect(items.map((item) => item.pageId)).toEqual(['title', 'body']);
    expect(items[1]).toMatchObject({
      id: 'page:body',
      kind: 'page',
      title: 'Notes',
      icon: '📄',
      breadcrumb: 'Workspace / Projects',
      subtitle: 'Workspace / Projects',
      blockId: 'block-1',
      snippet: results[1].snippet,
    });
    expect(items[0].blockId).toBeNull();
  });

  it('handles empty responses, root pages and localized untitled pages', () => {
    expect(mapSearchResults([], 'Sin título')).toEqual([]);
    const untitled = { ...result('root', '  ', true), path: [] };
    expect(mapSearchResults([untitled], 'Sin título')[0]).toMatchObject({
      title: 'Sin título',
      breadcrumb: undefined,
      subtitle: undefined,
    });
  });

  it('links body matches to the matching block and title matches to the page', () => {
    expect(searchPageHref({ pageId: 'page', blockId: null })).toBe('/p/page');
    expect(searchPageHref({ pageId: 'page', blockId: 'block/a?b' })).toBe(
      '/p/page?blockId=block%2Fa%3Fb',
    );
  });
});

describe('snippet text runs', () => {
  it('preserves Unicode, whitespace, match boundaries and literal markup', () => {
    const parts = [
      { text: '<script> & ', match: false },
      { text: 'planificación', match: true },
      { text: ' ', match: false },
      { text: 'semanal', match: true },
      { text: '</script>', match: false },
    ];
    const runs = snippetRuns(parts);
    expect(runs.map(({ text }) => text).join('')).toBe('<script> & planificación semanal</script>');
    expect(runs.map(({ match }) => match)).toEqual([false, true, false, true, false]);
    expect(parts[0]).toEqual({ text: '<script> & ', match: false });
  });

  it('gives repeated runs distinct keys and omits empty runs without losing text', () => {
    const runs = snippetRuns([
      { text: '', match: false },
      { text: 'same', match: true },
      { text: 'same', match: false },
      { text: '', match: true },
    ]);
    expect(runs).toEqual([
      { key: '0', text: 'same', match: true },
      { key: '4', text: 'same', match: false },
    ]);
    expect(snippetRuns([])).toEqual([]);
  });
});
