-- oxy:deploy-phase=pre
-- Pending invitations by email (`workspace_invites`) and the workspace join
-- link (`workspace_invite_links`). Additive: two new, empty tables the image
-- before it never reads. Their keys to `workspaces` come last, so its lock
-- (SHARE ROW EXCLUSIVE: reads and writes go on) is held only to the commit.
CREATE TABLE "workspace_invite_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_invite_links_role" CHECK ("workspace_invite_links"."role" in ('viewer', 'commenter', 'editor'))
);--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "workspace_invites_email_lower" CHECK ("workspace_invites"."email" = lower("workspace_invites"."email")),
	CONSTRAINT "workspace_invites_role" CHECK ("workspace_invites"."role" in ('viewer', 'commenter', 'editor', 'admin'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invite_links_token_key" ON "workspace_invite_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invite_links_live_key" ON "workspace_invite_links" USING btree ("workspace_id") WHERE "workspace_invite_links"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_pending_key" ON "workspace_invites" USING btree ("workspace_id","email") WHERE "workspace_invites"."accepted_at" is null;--> statement-breakpoint
CREATE INDEX "workspace_invites_pending_email_idx" ON "workspace_invites" USING btree ("email") WHERE "workspace_invites"."accepted_at" is null;--> statement-breakpoint
ALTER TABLE "workspace_invite_links" ADD CONSTRAINT "workspace_invite_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
