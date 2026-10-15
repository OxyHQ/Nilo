import type { SearchResult, SearchSnippetPart } from '@/lib/types/search';
import type { PageItem } from './types';

/** Keep server ranking and body-only matches; never fuzzy-filter these rows. */
export function mapSearchResults(results: SearchResult[], untitled: string): PageItem[] {
  return results.map(({ page, path, blockId, snippet }) => ({
    kind: 'page',
    id: `page:${page.id}`,
    pageId: page.id,
    title: page.title.trim() || untitled,
    icon: page.icon,
    searchValue: page.title,
    breadcrumb: path.join(' / ') || undefined,
    subtitle: path.join(' / ') || undefined,
    blockId,
    snippet,
  }));
}

/** Offsets give repeated text runs distinct, stable keys without interpreting markup. */
export function snippetRuns(parts: SearchSnippetPart[]) {
  let offset = 0;
  return parts
    .filter((part) => part.text.length > 0)
    .map((part) => {
      const run = { ...part, key: String(offset) };
      offset += part.text.length;
      return run;
    });
}

export function searchPageHref(item: Pick<PageItem, 'pageId' | 'blockId'>): `/p/${string}` {
  const path = `/p/${encodeURIComponent(item.pageId)}` as const;
  return item.blockId ? `${path}?blockId=${encodeURIComponent(item.blockId)}` : path;
}
