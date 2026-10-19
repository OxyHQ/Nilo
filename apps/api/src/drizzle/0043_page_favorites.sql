-- oxy:deploy-phase=pre
-- A favorite becomes each person's own (`page_favorites`). Additive: the
-- image before it keeps reading `pages.favorited`, which a post migration
-- drops later. Every page starred until now stays starred for its owner.
-- The copy runs before the foreign key, so it reads `pages` under its
-- lightest lock; the key's lock on `pages` is held only to the commit.
CREATE TABLE "page_favorites" (
	"page_id" text NOT NULL,
	"user_id" text NOT NULL,
	"order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_favorites_page_id_user_id_pk" PRIMARY KEY("page_id","user_id")
);
--> statement-breakpoint
INSERT INTO "page_favorites" ("page_id", "user_id", "order")
SELECT "id", "owner_id", row_number() OVER (PARTITION BY "owner_id" ORDER BY "order", "created_at", "id")
FROM "pages"
WHERE "favorited";--> statement-breakpoint
CREATE INDEX "page_favorites_user_order_idx" ON "page_favorites" USING btree ("user_id","order");--> statement-breakpoint
ALTER TABLE "page_favorites" ADD CONSTRAINT "page_favorites_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
