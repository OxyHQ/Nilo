-- oxy:deploy-phase=pre
-- 0058's CHECKs, verified against the rows now that they are in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes go on meanwhile).
ALTER TABLE "databases" VALIDATE CONSTRAINT "databases_property_types";--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_type";
