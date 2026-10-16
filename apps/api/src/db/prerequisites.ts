/**
 * What the database needs that the Drizzle schema cannot say: extensions,
 * text search configurations, functions and collations the schema's indexes
 * and queries name. Migrations create them (`0018_unaccent_search`,
 * `0036_fuzzy_titles`, `0038_view_rows_keyset`);
 * the test database runs these before the schema's DDL.
 * `prerequisites.test.ts` holds the two to the same statements.
 */
export const DATABASE_PREREQUISITES: readonly string[] = [
  'CREATE EXTENSION IF NOT EXISTS unaccent',
  // Search that ignores accents: `simple` (no stemming, every language alike)
  // with `unaccent` first, so "cancion" finds "canción".
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'nilo_search') THEN
    CREATE TEXT SEARCH CONFIGURATION nilo_search (COPY = simple);
    ALTER TEXT SEARCH CONFIGURATION nilo_search
      ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
      WITH unaccent, simple;
  END IF;
END $$`,
  // Titles found with a typo: trigrams over the title folded to lower case
  // without accents. `unaccent` is STABLE (its dictionary is looked up by
  // name); naming it by schema makes the fold IMMUTABLE, so it can be indexed.
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  `DO $$
DECLARE
  schema_name text;
BEGIN
  SELECT n.nspname INTO STRICT schema_name
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION nilo_fold(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS %L',
    format('SELECT lower(%I.unaccent(%L::regdictionary, $1))', schema_name, schema_name || '.unaccent')
  );
END $$`,
  // The order a view sorts text in (`lib/databases/view-query.ts`): ICU's
  // root collation with canonically equivalent strings equal, as
  // `compareText` sorts in JS. Nondeterministic, so strings it cannot tell
  // apart tie and the next sort key decides, as they do in JS.
  "CREATE COLLATION IF NOT EXISTS nilo_sort (provider = icu, locale = 'en-u-kk', deterministic = false)",
];
