-- oxy:deploy-phase=post
-- The image being replaced records editor transactions here until it stops.
DROP TABLE "page_transactions" CASCADE;