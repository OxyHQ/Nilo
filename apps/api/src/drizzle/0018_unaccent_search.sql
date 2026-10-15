-- oxy:deploy-phase=pre
-- Search that ignores accents: `nilo_search` is `simple` with `unaccent`
-- ("cancion" finds "canción"). `unaccent` is a trusted extension (PostgreSQL
-- 13+), so the database owner can create it. The new indexes come first; the
-- old ones go in the next (post-deploy) migration, once no release queries them.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'nilo_search') THEN
    CREATE TEXT SEARCH CONFIGURATION nilo_search (COPY = simple);
    ALTER TEXT SEARCH CONFIGURATION nilo_search
      ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
      WITH unaccent, simple;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX "blocks_text_fts_idx" ON "blocks" USING gin (to_tsvector('nilo_search'::regconfig, coalesce("content" ->> 'text', '')));--> statement-breakpoint
CREATE INDEX "pages_title_fts_idx" ON "pages" USING gin (to_tsvector('nilo_search'::regconfig, "title"));