-- oxy:deploy-phase=pre
-- Page verification and database automations. Properties admit one more type,
-- `verification`, notifications two more (`verification_expired`, `automation`);
-- `page_verifications` holds each verified page's expiry so the sweep finds what is
-- due by index, and `database_automations` holds the automations. Additive: the
-- image before it writes none of them. Both CHECKs are replaced NOT VALID (no
-- scan under this migration's lock) and validated in 0061.
CREATE TABLE "page_verifications" (
	"page_id" text NOT NULL,
	"property_id" text NOT NULL,
	"verified_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "page_verifications_page_id_property_id_pk" PRIMARY KEY("page_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "database_automations" (
	"id" text PRIMARY KEY NOT NULL,
	"database_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"secret" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "database_automations_last_status" CHECK ("database_automations"."last_status" is null or "database_automations"."last_status" in ('ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "databases" DROP CONSTRAINT "databases_property_types";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "page_verifications" ADD CONSTRAINT "page_verifications_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_automations" ADD CONSTRAINT "database_automations_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_verifications_due_idx" ON "page_verifications" USING btree ("expires_at") WHERE "page_verifications"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "database_automations_database_idx" ON "database_automations" USING btree ("database_id") WHERE "database_automations"."enabled";--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_property_types" CHECK (not jsonb_path_exists("databases"."properties_schema", '$.properties[*].type ? (!(@ == "text" || @ == "number" || @ == "select" || @ == "multi_select" || @ == "status" || @ == "date" || @ == "person" || @ == "files" || @ == "checkbox" || @ == "url" || @ == "email" || @ == "phone" || @ == "relation" || @ == "rollup" || @ == "created_time" || @ == "last_edited_time" || @ == "created_by" || @ == "last_edited_by" || @ == "formula" || @ == "unique_id" || @ == "button" || @ == "verification"))'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder', 'page_comment', 'page_edited', 'assigned', 'verification_expired', 'automation'));