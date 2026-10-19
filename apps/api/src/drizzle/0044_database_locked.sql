-- oxy:deploy-phase=pre
-- A database can be locked (`databases.locked`). Additive, with a constant
-- default: no row is rewritten, and the image before it never reads it.
ALTER TABLE "databases" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;
