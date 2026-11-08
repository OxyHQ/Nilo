-- oxy:deploy-phase=pre
-- Webhooks the receiver has not taken yet, waiting for a later try. A new table nothing before it reads.
CREATE TABLE "automation_webhook_retries" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"url" text NOT NULL,
	"body" text NOT NULL,
	"delivery_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_webhook_retries" ADD CONSTRAINT "automation_webhook_retries_automation_id_database_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."database_automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_webhook_retries_due_idx" ON "automation_webhook_retries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "automation_webhook_retries_automation_idx" ON "automation_webhook_retries" USING btree ("automation_id");