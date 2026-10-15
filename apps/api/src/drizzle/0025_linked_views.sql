-- oxy:deploy-phase=pre
ALTER TABLE "database_views" ADD COLUMN "block_id" text;--> statement-breakpoint
ALTER TABLE "database_views" ADD CONSTRAINT "database_views_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "database_views_block_idx" ON "database_views" USING btree ("block_id");