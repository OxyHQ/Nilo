-- oxy:deploy-phase=pre
-- Titles found with a typo: trigrams (`pg_trgm`, a trusted extension since
-- PostgreSQL 13, so the database owner creates it, as `unaccent` in 0018)
-- over `nilo_fold`, the title in lower case without accents. `unaccent` is
-- only STABLE, because its dictionary is looked up by name: naming it by
-- schema makes the fold IMMUTABLE, so it can be indexed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DO $$
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
END $$;--> statement-breakpoint
CREATE INDEX "pages_title_trgm_idx" ON "pages" USING gin (nilo_fold("title") gin_trgm_ops);
