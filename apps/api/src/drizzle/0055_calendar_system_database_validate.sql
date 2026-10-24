-- oxy:deploy-phase=pre
-- 0054's CHECK, verified against the rows now that it is in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes go on meanwhile).
ALTER TABLE "databases" VALIDATE CONSTRAINT "databases_system_key";
