/**
 * What the database does that the Drizzle schema cannot say: functions and
 * triggers. They run after the schema's DDL (they name its tables), are
 * created by migration `0039_file_references`, and the test database runs
 * these same statements after rendering the schema. `triggers.test.ts` holds
 * the two to the same text, as `prerequisites.test.ts` does for
 * `prerequisites.ts`.
 *
 * drizzle-kit does not know these exist: a later `db:generate` neither
 * recreates nor drops them, so a migration that rebuilds `page_files` or
 * `pages` must create them again.
 *
 * ## Which Oxy references Nilo holds, and when one goes
 *
 * Nilo uses a file on a page — Oxy's reference `(file, Nilo, 'page', page)`,
 * made by the file's owner from their app (Oxy ADR 0043, `docs/files.md`) —
 * while either holds:
 *
 * - a `page_files` row records the file as uploaded to that page (the row
 *   outlives the page while a copy of its block still holds the file); or
 * - the page exists and one of its properties lists the file
 *   (`{ files: [{ fileId }] }`: Noted's attachments, which are Nilo pages).
 *
 * When the last of them ends — a `page_files` row deleted, a page deleted,
 * a file taken out of a page's properties — the removal is queued in
 * `file_reference_removals` in the same statement, whichever path did it, and
 * sent by `lib/file-references.ts`. `'page'` is `NILO_FILE_ENTITY_TYPE`.
 */
export const DATABASE_TRIGGERS: readonly string[] = [
  // The Oxy files a page's properties list.
  `CREATE OR REPLACE FUNCTION nilo_property_file_ids(properties jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE AS $$
  SELECT DISTINCT f.value ->> 'fileId'
  FROM jsonb_each(CASE WHEN jsonb_typeof(properties) = 'object' THEN properties ELSE '{}'::jsonb END) AS p
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.value -> 'files') = 'array' THEN p.value -> 'files' ELSE '[]'::jsonb END
  ) AS f
  WHERE jsonb_typeof(f.value) = 'object' AND f.value ->> 'fileId' IS NOT NULL
$$`,
  `CREATE OR REPLACE FUNCTION nilo_release_page_file_reference() RETURNS trigger
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
$$`,
  `CREATE OR REPLACE FUNCTION nilo_release_page_property_references() RETURNS trigger
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
$$`,
  'DROP TRIGGER IF EXISTS page_files_release_reference ON page_files',
  `CREATE TRIGGER page_files_release_reference AFTER DELETE ON page_files
FOR EACH ROW EXECUTE FUNCTION nilo_release_page_file_reference()`,
  'DROP TRIGGER IF EXISTS pages_release_property_references ON pages',
  `CREATE TRIGGER pages_release_property_references AFTER DELETE OR UPDATE OF properties ON pages
FOR EACH ROW EXECUTE FUNCTION nilo_release_page_property_references()`,
];
