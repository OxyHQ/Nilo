-- oxy:deploy-phase=pre
ALTER TABLE "pages" ADD COLUMN "blocks_version" integer DEFAULT 0 NOT NULL;