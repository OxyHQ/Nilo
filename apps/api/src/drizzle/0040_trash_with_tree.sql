-- oxy:deploy-phase=pre
-- A subpage goes to the trash with its page (`archived_with`). Additive: the
-- image before it never reads the column. The live subpages of pages already
-- in the trash go there with them, so the trash means one thing from here on.
ALTER TABLE "pages" ADD COLUMN "archived_with" text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_archived_with_pages_id_fk" FOREIGN KEY ("archived_with") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_archived_with_idx" ON "pages" USING btree ("archived_with") WHERE "pages"."archived_with" is not null;--> statement-breakpoint
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
