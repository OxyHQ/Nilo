-- oxy:deploy-phase=pre
CREATE TABLE "teamspace_members" (
	"teamspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teamspace_members_teamspace_id_user_id_pk" PRIMARY KEY("teamspace_id","user_id"),
	CONSTRAINT "teamspace_members_role" CHECK ("teamspace_members"."role" in ('member', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "teamspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"description" text DEFAULT '' NOT NULL,
	"privacy" text DEFAULT 'open' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "teamspaces_privacy" CHECK ("teamspaces"."privacy" in ('open', 'closed', 'private')),
	CONSTRAINT "teamspaces_name_length" CHECK (char_length("teamspaces"."name") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "teamspace_id" text;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "teamspace_id" text;--> statement-breakpoint
ALTER TABLE "teamspace_members" ADD CONSTRAINT "teamspace_members_teamspace_id_teamspaces_id_fk" FOREIGN KEY ("teamspace_id") REFERENCES "public"."teamspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspaces" ADD CONSTRAINT "teamspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teamspace_members_user_idx" ON "teamspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teamspaces_workspace_idx" ON "teamspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teamspaces_one_default_per_workspace" ON "teamspaces" USING btree ("workspace_id") WHERE "teamspaces"."is_default";--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_teamspace_id_teamspaces_id_fk" FOREIGN KEY ("teamspace_id") REFERENCES "public"."teamspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_teamspace_id_teamspaces_id_fk" FOREIGN KEY ("teamspace_id") REFERENCES "public"."teamspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_teamspace_idx" ON "pages" USING btree ("teamspace_id");--> statement-breakpoint
CREATE INDEX "databases_teamspace_idx" ON "databases" USING btree ("teamspace_id");