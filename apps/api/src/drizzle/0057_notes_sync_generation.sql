-- oxy:deploy-phase=pre
CREATE TABLE "notes_sync_generations" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"generation" text NOT NULL
);
