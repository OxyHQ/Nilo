-- oxy:deploy-phase=pre
CREATE TABLE "page_follows" (
	"page_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_follows_page_id_user_id_pk" PRIMARY KEY("page_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "page_follows" ADD CONSTRAINT "page_follows_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_follows_user_idx" ON "page_follows" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder', 'page_comment'));