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

/**
 * The tsquery for what someone typed: every word, as a prefix, all required
 * (`plan:* & semana:*`). Words are runs of letters and digits, so nothing
 * the user types reaches `to_tsquery` as syntax. Null when there is no word.
 */
export function prefixQuery(input: string): string | null {
  const words =
    input
      .slice(0, MAX_QUERY_LENGTH)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(words)].slice(0, MAX_TERMS);
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

/**
 * Live pages of `workspaceId` whose title matches `query` (a `prefixQuery`),
 * best first. The tsvector expression is `pages_title_fts_idx`'s.
 */
export async function searchPageTitles(
  db: PgHandle,
  workspaceId: string,
  query: string,
  limit: number,
): Promise<TitleHit[]> {
  const rows = await db.execute(sql`
    select ${col(pages.id)} as id,
           ts_rank(to_tsvector('nilo_search'::regconfig, ${col(pages.title)}), to_tsquery('nilo_search'::regconfig, ${query})) as rank
    from ${pages}
    where ${col(pages.workspaceId)} = ${workspaceId}
      and not ${col(pages.archived)}
      and to_tsvector('nilo_search'::regconfig, ${col(pages.title)}) @@ to_tsquery('nilo_search'::regconfig, ${query})
    order by rank desc, ${col(pages.updatedAt)} desc
    limit ${limit}
  `);
  return rows.map((row) => ({ pageId: String(row.id), rank: Number(row.rank) }));
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
        and not p.${col(pages.archived)}
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
