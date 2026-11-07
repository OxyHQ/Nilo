-- oxy:deploy-phase=pre
-- System databases admit one more key, `memories`: the personal workspace's
-- long-term memory for AI agents (`docs/memories.md`), made on first use.
-- Additive: the image before it writes none. The CHECK is replaced NOT VALID
-- (no scan under this migration's lock) and validated in 0059.
ALTER TABLE "databases" DROP CONSTRAINT "databases_system_key";--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_system_key" CHECK ("databases"."system_key" in ('notes', 'note_folders', 'calendar', 'memories')) NOT VALID;
