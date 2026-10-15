-- oxy:deploy-phase=pre
ALTER TABLE "pages" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "publish_slug" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "publish_indexing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_publish_slug_key" ON "pages" USING btree ("publish_slug");