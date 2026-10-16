-- oxy:deploy-phase=pre
-- Additive: what a page still has to project, kept in the database. The
-- image before it neither reads nor writes these; the one after marks, at
-- start, every page with an update its rows may not show, and projects it.
ALTER TABLE "page_docs" ADD COLUMN "projected_through_id" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "page_docs" ADD COLUMN "dirty_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "page_docs_dirty_idx" ON "page_docs" USING btree ("dirty_since") WHERE "page_docs"."dirty_since" is not null;
