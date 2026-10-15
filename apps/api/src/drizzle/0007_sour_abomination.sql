-- oxy:deploy-phase=pre
CREATE INDEX "blocks_text_search_idx" ON "blocks" USING gin (to_tsvector('simple', coalesce("content" ->> 'text', '')));--> statement-breakpoint
CREATE INDEX "pages_title_search_idx" ON "pages" USING gin (to_tsvector('simple', "title"));