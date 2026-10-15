export interface SearchSnippetPart {
  text: string;
  match: boolean;
}

export interface SearchResult {
  page: { id: string; title: string; icon: string | null; parentId: string | null };
  path: string[];
  matchedTitle: boolean;
  blockId: string | null;
  snippet: SearchSnippetPart[];
}

export interface SearchResponse {
  results: SearchResult[];
}
