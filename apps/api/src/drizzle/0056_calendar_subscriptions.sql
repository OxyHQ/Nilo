-- oxy:deploy-phase=pre
-- Calendar subscriptions: a table of its own, and databases.read_only for the
-- calendar each one keeps. Additive: the image before it reads neither.
CREATE TABLE "calendar_subscriptions" (
	"database_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"url_sealed" text NOT NULL,
	"url_fingerprint" text NOT NULL,
	"url_host" text NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_http_status" integer,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"etag" text,
	"last_modified" text,
	"content_hash" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"simplified_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_change_at" timestamp with time zone,
	"next_refresh_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshing_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "calendar_subscriptions_status" CHECK ("calendar_subscriptions"."status" in ('pending', 'ok', 'failing')),
	CONSTRAINT "calendar_subscriptions_last_error" CHECK ("calendar_subscriptions"."last_error" is null or "calendar_subscriptions"."last_error" in ('unreachable', 'http_error', 'not_a_calendar', 'too_large', 'too_many_events', 'unsafe_url', 'internal'))
);
--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_subscriptions_due_idx" ON "calendar_subscriptions" USING btree ("next_refresh_at");--> statement-breakpoint
CREATE INDEX "calendar_subscriptions_owner_idx" ON "calendar_subscriptions" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_subscriptions_owner_url" ON "calendar_subscriptions" USING btree ("owner_id","url_fingerprint");