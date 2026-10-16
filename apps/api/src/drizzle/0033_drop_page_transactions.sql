-- oxy:deploy-phase=pre
-- Shipped as `post` and applied in production with 6cd534d (#88); no image
-- records editor transactions here since, so it is safe ahead of any rollout.
-- As `pre` it no longer holds later `pre` migrations behind it, nor a
-- from-zero deploy.
-- The image it replaced recorded editor transactions here until it stopped.
DROP TABLE "page_transactions" CASCADE;