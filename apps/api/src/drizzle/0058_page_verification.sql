-- oxy:deploy-phase=pre
-- Properties admit one more type, `verification`, and notifications one more,
-- `verification_expired`; `page_verifications` holds the expiry of each
-- verified page so the sweep finds what is due by index. Additive: the image
-- before it writes none of them. Both CHECKs are replaced NOT VALID (no scan
-- under this migration's lock) and validated in 0059.
CREATE TABLE "page_verifications" (
	"page_id" text NOT NULL,
	"property_id" text NOT NULL,
	"verified_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "page_verifications_page_id_property_id_pk" PRIMARY KEY("page_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "databases" DROP CONSTRAINT "databases_property_types";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "page_verifications" ADD CONSTRAINT "page_verifications_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_verifications_due_idx" ON "page_verifications" USING btree ("expires_at") WHERE "page_verifications"."notified_at" is null;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_property_types" CHECK (not jsonb_path_exists("databases"."properties_schema", '$.properties[*].type ? (!(@ == "text" || @ == "number" || @ == "select" || @ == "multi_select" || @ == "status" || @ == "date" || @ == "person" || @ == "files" || @ == "checkbox" || @ == "url" || @ == "email" || @ == "phone" || @ == "relation" || @ == "rollup" || @ == "created_time" || @ == "last_edited_time" || @ == "created_by" || @ == "last_edited_by" || @ == "formula" || @ == "unique_id" || @ == "button" || @ == "verification"))')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder', 'page_comment', 'page_edited', 'assigned', 'verification_expired')) NOT VALID;
