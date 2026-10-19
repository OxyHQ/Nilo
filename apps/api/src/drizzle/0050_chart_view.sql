-- oxy:deploy-phase=pre
-- Views admit one more type, `chart`, and properties one more, `button`; a
-- board's views gain sub-groups (`sub_group_by`, nullable: no rewrite).
-- Additive: the image before it writes none of them. Both CHECKs are replaced
-- NOT VALID (no scan under this migration's lock) and validated in 0051.
ALTER TABLE "database_views" DROP CONSTRAINT "database_views_type";--> statement-breakpoint
ALTER TABLE "databases" DROP CONSTRAINT "databases_property_types";--> statement-breakpoint
ALTER TABLE "database_views" ADD COLUMN "sub_group_by" jsonb;--> statement-breakpoint
ALTER TABLE "database_views" ADD CONSTRAINT "database_views_type" CHECK ("database_views"."type" in ('table', 'board', 'gallery', 'list', 'calendar', 'timeline', 'form', 'chart')) NOT VALID;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_property_types" CHECK (not jsonb_path_exists("databases"."properties_schema", '$.properties[*].type ? (!(@ == "text" || @ == "number" || @ == "select" || @ == "multi_select" || @ == "status" || @ == "date" || @ == "person" || @ == "files" || @ == "checkbox" || @ == "url" || @ == "email" || @ == "phone" || @ == "relation" || @ == "rollup" || @ == "created_time" || @ == "last_edited_time" || @ == "created_by" || @ == "last_edited_by" || @ == "formula" || @ == "unique_id" || @ == "button"))')) NOT VALID;