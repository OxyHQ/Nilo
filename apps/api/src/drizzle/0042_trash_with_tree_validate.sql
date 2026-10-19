-- oxy:deploy-phase=pre
-- 0040's foreign key, checked against the rows now that it is in place
-- (SHARE UPDATE EXCLUSIVE: reads and writes of pages go on meanwhile).
ALTER TABLE "pages" VALIDATE CONSTRAINT "pages_archived_with_pages_id_fk";
