-- oxy:deploy-phase=pre
-- 0047's CHECK, verified against the rows now that it is in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes of blocks go on meanwhile).
ALTER TABLE "blocks" VALIDATE CONSTRAINT "blocks_type";
