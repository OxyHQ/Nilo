-- oxy:deploy-phase=pre
-- The live subpages of pages already in the trash go there with them, so the
-- trash means one thing from here on. Only those rows are written: the walk
-- starts at archived pages (`pages_workspace_archived_idx`) and goes down
-- through `pages_parent_idx`, stopping at a page that is itself archived.
WITH RECURSIVE "tree" AS (
  SELECT "id" AS "root", "id" FROM "pages" WHERE "archived"
  UNION ALL
  SELECT "tree"."root", "child"."id"
  FROM "pages" "child" JOIN "tree" ON "child"."parent_id" = "tree"."id"
  WHERE NOT "child"."archived"
) CYCLE "id" SET "is_cycle" USING "cycle_path"
UPDATE "pages" SET "archived" = true, "archived_with" = "tree"."root"
FROM "tree"
WHERE "pages"."id" = "tree"."id" AND "tree"."id" <> "tree"."root" AND NOT "tree"."is_cycle";
