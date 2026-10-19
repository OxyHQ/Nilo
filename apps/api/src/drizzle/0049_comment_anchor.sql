-- oxy:deploy-phase=pre
-- Comments may be on a stretch of a block's text (`anchor`: offsets and the
-- quoted text). Additive and nullable: the image before it writes none and
-- reads past it. `comments` is hot, so the column is added alone here, with no
-- default and no backfill (a catalog-only change under a brief lock).
ALTER TABLE "comments" ADD COLUMN "anchor" jsonb;
