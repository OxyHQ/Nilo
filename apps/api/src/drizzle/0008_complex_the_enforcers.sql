-- oxy:deploy-phase=pre
ALTER TABLE "pages" ADD COLUMN "template" boolean DEFAULT false NOT NULL;