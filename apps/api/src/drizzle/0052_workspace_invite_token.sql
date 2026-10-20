-- oxy:deploy-phase=pre
-- workspace_invites.token (new, nullable) and its unique index: the secret of
-- an invitation's link, `/invite/<token>`, which the invitation email carries.
-- Additive: the serving image neither reads nor writes the column, and its
-- inserts leave it NULL, which the unique index allows any number of. Rows made
-- before this have no link and get none: nothing was ever sent for them.
-- `workspace_invites` is small and not a hot table; the index builds in the
-- same transaction as the column it covers.
ALTER TABLE "workspace_invites" ADD COLUMN "token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_token_key" ON "workspace_invites" USING btree ("token");