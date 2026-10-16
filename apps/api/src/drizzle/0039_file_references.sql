-- oxy:deploy-phase=pre
-- Additive. Nilo tells Oxy when it stops using a file (Oxy ADR 0043): the
-- removal queue and the triggers that fill it (db/triggers.ts), the file
-- events applied, what Oxy last said about each file, and the daily run's
-- lease. `page_files.page_id` stops being a foreign key: it names the Oxy
-- reference and must outlive the page (the previous image only compares it,
-- so a dangling id changes nothing for it).
CREATE TABLE "file_reference_removals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_reference_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"leased_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"report" jsonb,
	CONSTRAINT "file_reference_runs_job" CHECK ("file_reference_runs"."job" in ('nightly'))
);
--> statement-breakpoint
CREATE TABLE "oxy_file_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"file_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oxy_file_statuses" (
	"file_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oxy_file_statuses_status" CHECK ("oxy_file_statuses"."status" in ('active', 'trash', 'deleted', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "page_files" DROP CONSTRAINT "page_files_page_id_pages_id_fk";
--> statement-breakpoint
CREATE INDEX "file_reference_removals_due_idx" ON "file_reference_removals" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "oxy_file_events_received_idx" ON "oxy_file_events" USING btree ("received_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION nilo_property_file_ids(properties jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT f.value ->> 'fileId'
  FROM jsonb_each(CASE WHEN jsonb_typeof(properties) = 'object' THEN properties ELSE '{}'::jsonb END) AS p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.value -> 'files') = 'array' THEN p.value -> 'files' ELSE '[]'::jsonb END
  ) AS f
  WHERE jsonb_typeof(f.value) = 'object' AND f.value ->> 'fileId' IS NOT NULL
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION nilo_release_page_file_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pages p
    WHERE p.id = OLD.page_id AND OLD.file_id IN (SELECT nilo_property_file_ids(p.properties))
  ) THEN
    INSERT INTO file_reference_removals (file_id, entity_type, entity_id)
    VALUES (OLD.file_id, 'page', OLD.page_id);
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION nilo_release_page_property_references() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO file_reference_removals (file_id, entity_type, entity_id)
  SELECT gone.file_id, 'page', OLD.id
  FROM nilo_property_file_ids(OLD.properties) AS gone(file_id)
  WHERE (TG_OP = 'DELETE'
         OR gone.file_id NOT IN (SELECT nilo_property_file_ids(NEW.properties)))
    AND NOT EXISTS (
      SELECT 1 FROM page_files pf WHERE pf.file_id = gone.file_id AND pf.page_id = OLD.id
    );
  RETURN NULL;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS page_files_release_reference ON page_files;--> statement-breakpoint
CREATE TRIGGER page_files_release_reference AFTER DELETE ON page_files
FOR EACH ROW EXECUTE FUNCTION nilo_release_page_file_reference();--> statement-breakpoint
DROP TRIGGER IF EXISTS pages_release_property_references ON pages;--> statement-breakpoint
CREATE TRIGGER pages_release_property_references AFTER DELETE OR UPDATE OF properties ON pages
FOR EACH ROW EXECUTE FUNCTION nilo_release_page_property_references();