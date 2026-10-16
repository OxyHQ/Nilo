-- oxy:deploy-phase=pre
-- Shipped as `post` and applied in production with e56d43c; no image reads
-- `icon` since, so it is safe ahead of any rollout. As `pre` it no longer holds
-- later `pre` migrations behind it, nor a from-zero deploy.
-- The emoji the previous image read. The workspace picture is now `avatar`, an
-- Oxy file id; an emoji is not an image, so the old values are not carried over.
ALTER TABLE "workspaces" DROP COLUMN "icon";
