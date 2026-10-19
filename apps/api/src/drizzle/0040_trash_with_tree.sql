-- oxy:deploy-phase=pre
-- A subpage goes to the trash with its page (`archived_with`). Additive: the
-- image before it never reads the column. The foreign key is added NOT VALID
-- (no scan under this migration's lock) and validated in 0042.
ALTER TABLE "pages" ADD COLUMN "archived_with" text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_archived_with_pages_id_fk" FOREIGN KEY ("archived_with") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action NOT VALID;
