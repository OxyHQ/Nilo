-- oxy:deploy-phase=pre
-- A new CHECK no existing row can fail: the route has always refused to archive a
-- personal workspace, and the serving image writes nothing the CHECK rejects.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_personal_not_archived" CHECK (not ("workspaces"."is_personal" and "workspaces"."archived_at" is not null));
