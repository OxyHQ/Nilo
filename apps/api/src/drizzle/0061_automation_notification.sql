-- oxy:deploy-phase=pre
-- Notifications admit one more type, `automation`. Additive: the image before
-- it writes none. The CHECK is replaced NOT VALID (no scan under this
-- migration's lock) and validated in 0062.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder', 'page_comment', 'page_edited', 'assigned', 'verification_expired', 'automation')) NOT VALID;
