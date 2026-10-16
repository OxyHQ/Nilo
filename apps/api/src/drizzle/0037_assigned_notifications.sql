-- oxy:deploy-phase=pre
-- Widens the notification types by one ('assigned'); the image before it
-- never writes it.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('mention', 'comment_reply', 'page_shared', 'reminder', 'page_comment', 'page_edited', 'assigned'));
