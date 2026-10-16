-- oxy:deploy-phase=pre
-- Additive: a nullable column the serving image never reads.
ALTER TABLE "workspaces" ADD COLUMN "avatar" text;