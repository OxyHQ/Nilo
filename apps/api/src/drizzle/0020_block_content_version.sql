-- oxy:deploy-phase=pre
ALTER TABLE "blocks" ADD COLUMN "content_version" integer DEFAULT 0 NOT NULL;