-- oxy:deploy-phase=pre
-- Additive activity records for subsequent writes only; no historical backfill.
-- The only FK originates in the new table. Existing pages and file triggers remain intact.
CREATE TABLE "page_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"actor_ids" jsonb NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_activity_kind" CHECK ("page_activity"."kind" in ('created', 'metadata_changed', 'properties_changed', 'content_edited'))
);
--> statement-breakpoint
ALTER TABLE "page_activity" ADD CONSTRAINT "page_activity_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_activity_page_created_idx" ON "page_activity" USING btree ("page_id","created_at","id");
