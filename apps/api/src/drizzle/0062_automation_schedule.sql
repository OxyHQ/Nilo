-- oxy:deploy-phase=pre
-- A scheduled automation is due at `next_run_at`; the sweep finds what is due by
-- this partial index. Additive: a nullable column the image before it ignores.
ALTER TABLE "database_automations" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "database_automations_due_idx" ON "database_automations" USING btree ("next_run_at") WHERE "database_automations"."enabled" and "database_automations"."next_run_at" is not null;