-- oxy:deploy-phase=pre
CREATE TABLE "reminders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"page_id" text NOT NULL,
	"block_id" text,
	"remind_at" timestamp with time zone NOT NULL,
	"note" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_pending_idx" ON "reminders" USING btree ("remind_at") WHERE "reminders"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "reminders_user_remind_idx" ON "reminders" USING btree ("user_id","remind_at");--> statement-breakpoint
CREATE INDEX "reminders_page_idx" ON "reminders" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "reminders_block_idx" ON "reminders" USING btree ("block_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder'));