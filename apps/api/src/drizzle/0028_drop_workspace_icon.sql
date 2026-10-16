-- oxy:deploy-phase=post
-- The emoji the previous image reads. The workspace picture is now `avatar`, an
-- Oxy file id; an emoji is not an image, so the old values are not carried over.
ALTER TABLE "workspaces" DROP COLUMN "icon";