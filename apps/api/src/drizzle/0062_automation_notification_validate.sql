-- oxy:deploy-phase=pre
-- 0061's CHECK, verified against the rows now that it is in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes go on meanwhile).
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_type";
