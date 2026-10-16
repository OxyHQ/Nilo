# Databases

A database is a schema (`databases.properties_schema`: properties with an id,
a name, a type and a config) and rows, which are pages (`pages.database_id`,
values in `pages.properties` keyed by property id). Its views
(`database_views`) filter, sort, group and lay out the rows. Code:
`apps/api/src/routes/databases.ts`, `apps/api/src/lib/databases/`.

## Where a database lives

An inline database sits in a page (`parent_page_id`) and is as open as that
page. One in no page lives in a teamspace or privately with its owner
(`teamspace_id`), like a top-level page — `docs/access.md`.

## Values

Stored per type (`{ text }`, `{ number }`, `{ optionId }`, `{ start, end }`,
`{ pageIds }`…), validated on every write (`row-values.ts`). Computed at read
time, never stored: formulas, rollups, created/edited time and by.

- **Formulas** (`formula.ts`): Nilo's own language over the row — `prop("…")`,
  operators, text, dates, conditionals — evaluated without `eval`; errors are
  values (`{ text: '', error }`), never empty cells. Filters and sorts can
  use them.
- **Rollups** (`rollups.ts`): count, sum, average, min, max, earliest, latest
  over a relation. A view's rows are rolled up together: one query per
  rollup property, whatever the number of rows.
- **IDs** (`unique_id`): numbered by the server (`databases.next_row_number`),
  existing rows too when the property is added; clients never write them.

## Relations

A relation points at rows of a target database (`{ pageIds }`). With
`twoWay` it has an other side: a relation property in the target database
pointing back (`config.syncedPropertyId`, set by the server only). Creating,
editing or deleting a row's links updates the other side in the same
transaction (`relations.ts`, in SQL on `pageIds`); making a relation two-way
later fills the other side from existing links; deleting either side, making
it one-way or pointing it elsewhere removes the other. A database related to
itself two-way is **sub-items**: "Sub-items" and "Sub-items (parent)".

## Views

Table, board, calendar, gallery, list, timeline and form. A view's rows are
filtered, searched (by title), sorted and paged in PostgreSQL
(`view-query.ts`): its filter tree and sorts compile to SQL over the rows'
`properties` and page columns, and only the page asked for is read, with a
count of the view's rows (`total`). Among rows its sorts do not tell apart,
rows stay oldest first (the id breaks a tie). Empty values sort last
ascending, first descending; select and status options in the order they are
listed; text in ICU's root order, case and accents told apart (the `nilo_sort`
collation in SQL, `compareText` in JS).

Pages are a keyset: `cursor` is opaque (base64url JSON of the last row's sort
values, creation time and id), so a row added, edited or archived between two
requests moves nothing else across a page boundary. A cursor the API did not
issue, or one from another view, is a 400.

Formulas and rollups are computed, not stored, so a view that filters or
sorts on one computes them for every row and filters and sorts in JS
(`filters.ts`, `sorts.ts`), its cursor an offset. The two paths answer
alike: `view-query.pgdb.test.ts` checks the SQL against the JS on random
views over every stored property type.

A database's own
views are its editors' to change. An `inline_database` block showing a
database from elsewhere is a **linked view**: it has views of its own
(`database_views.block_id`, gone with the block), kept by whoever may edit
the block's page as long as they may open the database.

## Templates, forms, CSV

- **Row templates**: rows with `template`, never listed among the rows;
  creating a row from one copies its values, icon, cover and content.
- **Forms**: a view of type `form` with a public link (`/forms/:token`):
  responses become rows, without exposing the database; rate limited;
  optionally sign-in only.
- **CSV**: export one (stored properties as people read them), import one as
  a new database (each column typed by what all its values fit). A Notion
  export's databases (CSV, or HTML tables) import the same way, with their
  rows' pages (`POST /pages/import/zip`).

## System databases

A personal workspace always has `notes` and `note_folders`
(`databases.system_key`, `apps/api/src/lib/databases/system.ts`): Noted's
notes, one row per note, and their folders. They are private to the owner and
behave as any database in Nilo, but cannot be deleted (a reset empties them),
and the properties Noted reads cannot be removed, retyped or reconfigured;
renaming is fine, and labels stay editable. Rows deleted for good leave a
tombstone (`page_tombstones`, 30 days) for clients that sync them.

## Live

Rows, properties and views changing are announced to the database's room
(`database:changed`) — `docs/collaboration.md`.
