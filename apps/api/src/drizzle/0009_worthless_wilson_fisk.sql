-- oxy:deploy-phase=pre
-- The pages <-> databases foreign keys (see `databases.parentPageId`).
-- An inline database whose host page is already gone gets what ON DELETE SET
-- NULL would have given it, so the constraint validates.
UPDATE "databases" SET "parent_page_id" = NULL
WHERE "parent_page_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "pages" WHERE "pages"."id" = "databases"."parent_page_id");--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_parent_page_id_pages_id_fk" FOREIGN KEY ("parent_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Rows of a database that no longer exists would be deleted by ON DELETE
-- CASCADE; a migration does not delete them on its own. NOT VALID enforces
-- the key for every write from now on and leaves existing rows to be audited
-- and the constraint validated in a later post-deploy migration.
ALTER TABLE "pages" ADD CONSTRAINT "pages_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
