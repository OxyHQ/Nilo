import { sql } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { PgHandle } from '../db/client.js';
import { blocks, pages } from '../db/schema/pages.js';

/** A run of a snippet, marked when it is what matched. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface TitleHit {
  pageId: string;
  rank: number;
}

export interface BlockHit {
  pageId: string;
  blockId: string;
  rank: number;
  snippet: SnippetPart[];
}

/** The longest query worth parsing: a search box, not a document. */
const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;

/** The words of what someone typed: runs of letters and digits, at most `MAX_TERMS`. */
export function queryWords(input: string): string[] {
  const words =
    input
      .slice(0, MAX_QUERY_LENGTH)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/**
 * The tsquery for what someone typed: every word, as a prefix, all required
 * (`plan:* & semana:*`). Words are runs of letters and digits, so nothing
 * the user types reaches `to_tsquery` as syntax. Null when there is no word.
 */
export function prefixQuery(input: string): string | null {
  const terms = queryWords(input);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(' & ') : null;
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
 * Live pages of `workspaceId` whose title has every word typed, each as a
 * prefix or close to a word of the title, typos included (by trigrams),
 * best first: a title matching every word as typed ranks above any near one.
 * The expressions are `pages_title_fts_idx`'s and `pages_title_trgm_idx`'s.
 */
export async function searchPageTitles(
  db: PgHandle,
  workspaceId: string,
  words: readonly string[],
  limit: number,
  filter?: SearchFilter,
): Promise<TitleHit[]> {
  if (words.length === 0) return [];
  const vector = sql`to_tsvector('nilo_search'::regconfig, ${col(pages.title)})`;
  const prefix = (query: string) => sql`to_tsquery('nilo_search'::regconfig, ${query})`;
  const title = sql`nilo_fold(${col(pages.title)})`;
  const all = prefix(words.map((word) => `${word}:*`).join(' & '));
  const everyWord = sql.join(
    words.map(
      (word) => sql`(${vector} @@ ${prefix(`${word}:*`)} or nilo_fold(${word}) <% ${title})`,
    ),
    sql` and `,
  );
  const closeness = sql.join(
    words.map((word) => sql`word_similarity(nilo_fold(${word}), ${title})`),
    sql` + `,
  );
  return db.transaction(async (tx) => {
    // `<%` reads the threshold from the session; `set local` keeps it to this query.
    await tx.execute(
      sql`select set_config('pg_trgm.word_similarity_threshold', ${String(NEAR_WORD)}, true)`,
    );
    const rows = await tx.execute(sql`
      select ${col(pages.id)} as id,
             case when ${vector} @@ ${all} then 1 + ts_rank(${vector}, ${all}) else 0 end
               + (${closeness}) / ${words.length} as rank
      from ${pages}
      where ${col(pages.workspaceId)} = ${workspaceId}
        and not ${col(pages.archived)}
        and ${everyWord}${filterSql(filter)}
      order by rank desc, ${col(pages.updatedAt)} desc
      limit ${limit}
    `);
    return rows.map((row) => ({ pageId: String(row.id), rank: Number(row.rank) }));
  });
}

/**
 * The best-matching block per live page of `workspaceId`, best pages first,
 * with a snippet of it. The tsvector expression is `blocks_text_fts_idx`'s.
 */
export async function searchBlockText(
  db: PgHandle,
  workspaceId: string,
  query: string,
  limit: number,
  filter?: SearchFilter,
): Promise<BlockHit[]> {
  const text = sql`coalesce(b.${col(blocks.content)} ->> 'text', '')`;
  const rows = await db.execute(sql`
    with matched as (
      select b.${col(blocks.id)} as block_id,
             b.${col(blocks.pageId)} as page_id,
             ${text} as text,
             ts_rank(to_tsvector('nilo_search'::regconfig, ${text}), to_tsquery('nilo_search'::regconfig, ${query})) as rank,
             row_number() over (
               partition by b.${col(blocks.pageId)}
               order by ts_rank(to_tsvector('nilo_search'::regconfig, ${text}), to_tsquery('nilo_search'::regconfig, ${query})) desc
             ) as nth
      from ${blocks} b
      join ${pages} p on p.${col(pages.id)} = b.${col(blocks.pageId)}
      where p.${col(pages.workspaceId)} = ${workspaceId}
        and not p.${col(pages.archived)}${filterSql(filter, 'p')}
        and to_tsvector('nilo_search'::regconfig, ${text}) @@ to_tsquery('nilo_search'::regconfig, ${query})
    )
    select block_id, page_id, rank,
           ts_headline('nilo_search'::regconfig, text, to_tsquery('nilo_search'::regconfig, ${query}),
             ${`StartSel=${START}, StopSel=${STOP}, MaxWords=24, MinWords=8, MaxFragments=1`}) as headline
    from matched
    where nth = 1
    order by rank desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    pageId: String(row.page_id),
    blockId: String(row.block_id),
    rank: Number(row.rank),
    snippet: snippetParts(String(row.headline ?? '')),
  }));
}
