# Search

`GET /search` reads PostgreSQL pages and projected block text. Its response and
filters are described in [the API reference](api-reference.md#search-files-embeds-feedback).
The default limit is 20, at most 50; this endpoint has no cursor pagination.

## Query semantics

- Unquoted words are required prefixes. Titles also accept nearby spellings using
  PostgreSQL trigrams; body text does not. The first eight distinct unquoted words
  are used, retaining the existing bound on fuzzy comparisons.
- Closed double quotes require complete words together in order. For example,
  `roadmap "plan day"` requires the prefix `roadmap` and the phrase `plan day` in
  one title or one block. It does not match `planning day`, `plan days`, reversed
  words, words separated by another word, or words split across blocks.
- Phrase matching is lexical, not a byte-for-byte substring. PostgreSQL's
  `nilo_search` configuration folds case and accents without stemming; punctuation
  and whitespace follow its text parser. Thus `"plan day"` can match `plan, day`,
  and `"café azul"` matches `CAFE azul`. It is not a literal punctuation search.
- An unfinished quote is ordinary input while typing. Empty quotes are ignored.
  Boolean-looking operators are text, not an extra query language. Phrases are
  passed as parameters to `phraseto_tsquery`, never interpolated as SQL or tsquery
  syntax. A complete phrase is not shortened to the unquoted word budget.
- Input is limited to 500 characters by the API. Empty input returns no results
  unless a narrowing filter is present; filter-only results are latest edited first.
  Existing template behavior is preserved: textual searches include authorized live
  template pages; filter-only listings exclude templates.

This follows Notion's documented [quoted word/string search](https://www.notion.com/help/search)
without claiming identical tokenization or ranking. PostgreSQL documents the
[phrase parser's lexical semantics](https://www.postgresql.org/docs/current/textsearch-controls.html).

## Authorization, ranking, and storage

The route uses the existing page-access resolver for membership, grants,
ancestors, database homes, and teamspace visibility. It reuses the workspace page
metadata already needed for those checks and breadcrumb paths. Authorized IDs in
the requested teamspace are passed as one bound `text[]` parameter to the search
repository. Both title and body queries apply that scope, workspace, live-page,
creator, and date predicates before ranking or limiting. Private candidates cannot
consume result slots or expose their snippets or ancestor titles.

One SQL query combines a title score with the best matching block per page, then
applies the requested limit. Ties use edit time and page ID; block ties use block
ID. Highlight snippets are computed for final results and returned as plain text
parts, never HTML. The existing GIN full-text and trigram indexed expressions are
retained, and the eligibility CTE is not materialized so predicates can be pushed
to the indexed tables. There is no secondary index service or persistence path.

The PostgreSQL route tests cover complete phrases, unfinished quotes, accent
folding, private title/body candidates beyond the former candidate pools,
teamspace scoping before limits, combined ranking, inherited guest permissions,
and the existing filters and index availability. Parser tests cover operator-like
input and complete phrases longer than the unquoted word budget.
