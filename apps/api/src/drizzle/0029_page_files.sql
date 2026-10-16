-- oxy:deploy-phase=pre
-- Additive: a new table for attachments in Oxy's file manager.
CREATE TABLE "page_files" (
	"file_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"page_id" text,
	"uploaded_by" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_files_size" CHECK ("page_files"."size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "page_files" ADD CONSTRAINT "page_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_files" ADD CONSTRAINT "page_files_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_files_page_idx" ON "page_files" USING btree ("page_id");