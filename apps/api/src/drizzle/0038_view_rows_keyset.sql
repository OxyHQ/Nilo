-- oxy:deploy-phase=pre
-- Additive: the collation views sort text by and an index on live rows, both
-- unread by the serving image.
CREATE COLLATION IF NOT EXISTS nilo_sort (provider = icu, locale = 'en-u-kk', deterministic = false);--> statement-breakpoint
CREATE INDEX "pages_database_rows_idx" ON "pages" USING btree ("database_id","created_at","id") WHERE "pages"."archived" = false and "pages"."template" = false;