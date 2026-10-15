/**
 * What the database needs that the Drizzle schema cannot say: extensions and
 * text search configurations the schema's indexes and queries name.
 * Migrations create them (`0018_unaccent_search`); the test database runs
 * these before the schema's DDL. `prerequisites.test.ts` holds the two to the
 * same statements.
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
];
