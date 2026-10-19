-- oxy:deploy-phase=pre
-- Recents on every device (`page_visits`): when each person last opened each
-- page. Additive: a new, empty table the image before it never reads. Its key
-- to `pages` comes last, so that lock (SHARE ROW EXCLUSIVE: reads and writes
-- of pages go on) is held only to the commit.
CREATE TABLE "page_visits" (
	"user_id" text NOT NULL,
	"page_id" text NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_visits_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);--> statement-breakpoint
CREATE INDEX "page_visits_user_visited_idx" ON "page_visits" USING btree ("user_id","visited_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "page_visits_page_idx" ON "page_visits" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
