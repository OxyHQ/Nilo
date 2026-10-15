-- oxy:deploy-phase=pre
CREATE TABLE "database_forms" (
	"id" text PRIMARY KEY NOT NULL,
	"view_id" text NOT NULL,
	"database_id" text NOT NULL,
	"token" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"require_sign_in" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "database_views" DROP CONSTRAINT "database_views_type";--> statement-breakpoint
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_view_id_database_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."database_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_forms" ADD CONSTRAINT "database_forms_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "database_forms_view_key" ON "database_forms" USING btree ("view_id");--> statement-breakpoint
CREATE UNIQUE INDEX "database_forms_token_key" ON "database_forms" USING btree ("token");--> statement-breakpoint
CREATE INDEX "database_forms_database_idx" ON "database_forms" USING btree ("database_id");--> statement-breakpoint
ALTER TABLE "database_views" ADD CONSTRAINT "database_views_type" CHECK ("database_views"."type" in ('table', 'board', 'gallery', 'list', 'calendar', 'timeline', 'form'));