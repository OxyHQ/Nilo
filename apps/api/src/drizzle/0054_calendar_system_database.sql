-- oxy:deploy-phase=pre
-- System databases admit one more key, `calendar`: the personal workspace's own
-- calendar, made on first use. Additive: the image before it writes none. The
-- CHECK is replaced NOT VALID (no scan under this migration's lock) and
-- validated in 0055.
ALTER TABLE "databases" DROP CONSTRAINT "databases_system_key";--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_system_key" CHECK ("databases"."system_key" in ('notes', 'note_folders', 'calendar')) NOT VALID;
