-- oxy:deploy-phase=pre
-- Database automations: a table of its own. Additive: the image before it
-- reads none, and its only FK originates in the new table.
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
ALTER TABLE "database_automations" ADD CONSTRAINT "database_automations_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "database_automations_database_idx" ON "database_automations" USING btree ("database_id") WHERE "database_automations"."enabled";