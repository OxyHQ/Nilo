-- oxy:deploy-phase=pre
-- 0050's CHECKs, verified against the rows now that they are in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes go on meanwhile).
ALTER TABLE "database_views" VALIDATE CONSTRAINT "database_views_type";--> statement-breakpoint
ALTER TABLE "databases" VALIDATE CONSTRAINT "databases_property_types";
