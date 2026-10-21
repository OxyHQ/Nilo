import { sql, type SQL } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { PgHandle } from '../db/client.js';
import { blocks, pages } from '../db/schema/pages.js';

/** A run of a snippet, marked when it is what matched. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchHit {
  pageId: string;
  score: number;
  matchedTitle: boolean;
  blockId: string | null;
  snippet: SnippetPart[];
}

const MAX_QUERY_LENGTH = 500;
const MAX_TERMS = 8;

/** Unquoted words retain the existing bounded prefix/typo search. */
function queryWords(input: string): string[] {
  const words =
    input
      .slice(0, MAX_QUERY_LENGTH)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_TERMS);
}

export interface SearchQuery {
  words: string[];
  phrases: string[];
}

/**
 * Closed quotes require whole lexemes in order. An unfinished quote is ordinary
 * search input, so typing a quote does not hide all suggestions. Never shorten
 * a closed phrase to the unquoted word budget.
 */
export function parseSearchQuery(input: string): SearchQuery | null {
  const phrases: string[] = [];
  const unquoted = input
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/"([^"]*)"/g, (_match, phrase: string) => {
      if (/[\p{L}\p{N}]/u.test(phrase)) phrases.push(phrase);
      return ' ';
    });
  const words = queryWords(unquoted);
  return words.length || phrases.length ? { words, phrases } : null;
}

function phraseQueries(query: SearchQuery): SQL[] {
  return query.phrases.map((phrase) => sql`phraseto_tsquery('nilo_search'::regconfig, ${phrase})`);
}

function textQuery(query: SearchQuery): SQL {
  const clauses = phraseQueries(query);
  if (query.words.length) {
    clauses.unshift(
      sql`to_tsquery('nilo_search'::regconfig, ${query.words.map((word) => `${word}:*`).join(' & ')})`,
    );
  }
  return sql`(${sql.join(clauses, sql` && `)})`;
}

// ts_headline marks matches with these; control characters cannot occur in
// stored text worth showing, so splitting on them is unambiguous.
const START = '\u0002';
const STOP = '\u0003';

function snippetParts(headline: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const [i, chunk] of headline.split(START).entries()) {
    if (i === 0) {
      if (chunk) parts.push({ text: chunk, match: false });
      continue;
    }
    const [matched = '', rest = ''] = chunk.split(STOP);
    if (matched) parts.push({ text: matched, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  return parts;
}

const col = (column: Parameters<typeof sqlColumnName>[0]) => sql.identifier(sqlColumnName(column));

/** Narrowing a search: who created the page, and when it was last edited. */
export interface SearchFilter {
  /** The page's creator (`pages.owner_id`). */
  createdBy?: string;
  /** Edited at or after. */
  editedAfter?: Date;
  /** Edited before. */
  editedBefore?: Date;
}

/** The filter as predicates on `pages` (aliased `alias` when it is), each one ANDed in. */
function filterSql(filter: SearchFilter | undefined, alias?: string) {
  const column = (c: Parameters<typeof sqlColumnName>[0]) =>
    alias ? sql`${sql.identifier(alias)}.${col(c)}` : col(c);
  const parts = [];
  if (filter?.createdBy) parts.push(sql` and ${column(pages.ownerId)} = ${filter.createdBy}`);
  if (filter?.editedAfter) {
    parts.push(
      sql` and ${column(pages.updatedAt)} >= ${filter.editedAfter.toISOString()}::timestamptz`,
    );
  }
  if (filter?.editedBefore) {
    parts.push(
      sql` and ${column(pages.updatedAt)} < ${filter.editedBefore.toISOString()}::timestamptz`,
    );
  }
  return sql.join(parts, sql``);
}

/**
 * How close a word must be to one in a title to count (`word_similarity`):
 * one typo in a word of six letters is about 0.5.
 */
const NEAR_WORD = 0.45;

/**
 * Search only the IDs authorized by the shared page-access owner. Titles and
 * the best body block contribute to one score before the single final LIMIT;
 * inaccessible or out-of-teamspace candidates cannot consume result slots.
 * Keep the indexed vector/folding expressions identical to the GIN indexes.
 */
export async function searchPages(
  db: PgHandle,
  workspaceId: string,
  authorizedIds: readonly string[],
  query: SearchQuery,
  limit: number,
  titleOnly: boolean,
  filter?: SearchFilter,
): Promise<SearchHit[]> {
  if (!authorizedIds.length) return [];
  const vector = sql`to_tsvector('nilo_search'::regconfig, p.${col(pages.title)})`;
  const title = sql`nilo_fold(p.${col(pages.title)})`;
  const all = textQuery(query);
  const titleClauses = query.words.map(
    (word) =>
      sql`(${vector} @@ to_tsquery('nilo_search'::regconfig, ${`${word}:*`}) or nilo_fold(${word}) <% ${title})`,
  );
  titleClauses.push(...phraseQueries(query).map((phrase) => sql`${vector} @@ ${phrase}`));
  const closeness = query.words.length
    ? sql`(${sql.join(
        query.words.map((word) => sql`word_similarity(nilo_fold(${word}), ${title})`),
        sql` + `,
      )}) / ${query.words.length}`
    : sql`0`;
  const text = sql`coalesce(b.${col(blocks.content)} ->> 'text', '')`;
  const bodyVector = sql`to_tsvector('nilo_search'::regconfig, ${text})`;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('pg_trgm.word_similarity_threshold', ${String(NEAR_WORD)}, true)`,
    );
    const rows = await tx.execute(sql`
      with eligible as not materialized (
        select p.* from ${pages} p
        where p.${col(pages.workspaceId)} = ${workspaceId}
          and not p.${col(pages.archived)}
          and p.${col(pages.id)} = any(${sql.param(authorizedIds)}::text[])
          ${filterSql(filter, 'p')}
      ), title_hits as (
        select p.${col(pages.id)} as page_id, p.${col(pages.updatedAt)} as updated_at,
               1 + case when ${vector} @@ ${all} then 1 + ts_rank(${vector}, ${all}) else 0 end
                 + ${closeness} as score
        from eligible p
        where ${sql.join(titleClauses, sql` and `)}
      ), body_candidates as (
        select b.${col(blocks.id)} as block_id, p.${col(pages.id)} as page_id,
               p.${col(pages.updatedAt)} as updated_at, ${text} as text,
               ts_rank(${bodyVector}, ${all}) as score,
               row_number() over (
                 partition by p.${col(pages.id)}
                 order by ts_rank(${bodyVector}, ${all}) desc, b.${col(blocks.id)}
               ) as nth
        from ${blocks} b
        join eligible p on p.${col(pages.id)} = b.${col(blocks.pageId)}
        where ${!titleOnly} and ${bodyVector} @@ ${all}
      ), body_hits as (
        select * from body_candidates where nth = 1
      ), ranked as (
        select coalesce(t.page_id, b.page_id) as page_id,
               coalesce(t.score, 0) + coalesce(b.score, 0) as score,
               t.page_id is not null as matched_title, b.block_id, b.text,
               coalesce(t.updated_at, b.updated_at) as updated_at
        from title_hits t full join body_hits b on b.page_id = t.page_id
        order by score desc, updated_at desc, page_id
        limit ${limit}
      )
      select page_id, score, matched_title, block_id,
             case when block_id is not null then
               ts_headline('nilo_search'::regconfig, text, ${all},
                 ${`StartSel=${START}, StopSel=${STOP}, MaxWords=24, MinWords=8, MaxFragments=1`})
             else null end as headline
      from ranked
      order by score desc, updated_at desc, page_id
    `);
    return rows.map((row) => ({
      pageId: String(row.page_id),
      score: Number(row.score),
      matchedTitle: Boolean(row.matched_title),
      blockId: row.block_id == null ? null : String(row.block_id),
      snippet: snippetParts(String(row.headline ?? '')),
    }));
  });
}
