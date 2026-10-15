-- oxy:deploy-phase=pre
CREATE INDEX "blocks_segments_path_idx" ON "blocks" USING gin (("content" -> 'segments') jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "blocks_link_to_page_idx" ON "blocks" USING btree (("content" ->> 'pageId')) WHERE "blocks"."type" = 'link_to_page';