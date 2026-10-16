-- oxy:deploy-phase=pre
-- Additive: two new tables, nullable or defaulted columns, an index and CHECKs
-- every existing row already satisfies (system_key is null, app defaults to nilo).
CREATE TABLE "page_app_data" (
	"page_id" text NOT NULL,
	"app" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_app_data_page_id_app_pk" PRIMARY KEY("page_id","app"),
	CONSTRAINT "page_app_data_app" CHECK ("page_app_data"."app" in ('noted'))
);
--> statement-breakpoint
CREATE TABLE "page_tombstones" (
	"page_id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "app" text DEFAULT 'nilo' NOT NULL;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD COLUMN "app" text DEFAULT 'nilo' NOT NULL;--> statement-breakpoint
ALTER TABLE "page_app_data" ADD CONSTRAINT "page_app_data_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_tombstones" ADD CONSTRAINT "page_tombstones_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_tombstones_database_deleted_idx" ON "page_tombstones" USING btree ("database_id","deleted_at");--> statement-breakpoint
CREATE INDEX "pages_database_updated_idx" ON "pages" USING btree ("database_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "databases_workspace_system_key" ON "databases" USING btree ("workspace_id","system_key") WHERE "databases"."system_key" is not null;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_system_key" CHECK ("databases"."system_key" in ('notes', 'note_folders'));--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_app" CHECK ("push_tokens"."app" in ('nilo', 'noted'));--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_app" CHECK ("web_push_subscriptions"."app" in ('nilo', 'noted'));
