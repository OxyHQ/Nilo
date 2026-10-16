-- oxy:deploy-phase=pre
-- Additive: two new tables nothing reads yet.
CREATE TABLE "app_event_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "app_event_outbox_attempts_check" CHECK ("app_event_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capability_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tool" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_event_outbox_event_id_key" ON "app_event_outbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "app_event_outbox_pending_idx" ON "app_event_outbox" USING btree ("created_at") WHERE "app_event_outbox"."processed_at" is null and "app_event_outbox"."failed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "capability_executions_account_tool_key" ON "capability_executions" USING btree ("account_id","tool","idempotency_key");--> statement-breakpoint
CREATE INDEX "capability_executions_created_at_idx" ON "capability_executions" USING btree ("created_at");
