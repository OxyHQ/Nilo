-- oxy:deploy-phase=pre
ALTER TABLE "pages" ADD COLUMN "full_width" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "small_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "font" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_font" CHECK ("pages"."font" in ('default', 'serif', 'mono'));