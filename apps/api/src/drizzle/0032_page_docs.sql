-- oxy:deploy-phase=pre
-- Additive: a page's content as Yjs updates and their compacted snapshot.
CREATE TABLE "page_docs" (
	"page_id" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"through_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"update" "bytea" NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_docs" ADD CONSTRAINT "page_docs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_updates" ADD CONSTRAINT "page_updates_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_updates_page_idx" ON "page_updates" USING btree ("page_id","id");