-- oxy:deploy-phase=pre
CREATE TABLE "page_transactions" (
	"page_id" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"ops" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "page_transactions_page_id_key_pk" PRIMARY KEY("page_id","key")
);
--> statement-breakpoint
ALTER TABLE "page_transactions" ADD CONSTRAINT "page_transactions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_transactions_page_created_idx" ON "page_transactions" USING btree ("page_id","created_at");