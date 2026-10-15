-- oxy:deploy-phase=pre
-- The pages <-> databases foreign keys (see `databases.parentPageId`).
ALTER TABLE "databases" ADD CONSTRAINT "databases_parent_page_id_pages_id_fk" FOREIGN KEY ("parent_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;
