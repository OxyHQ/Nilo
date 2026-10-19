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
- **Rollups** (`rollups.ts`): count, sum, average, min, max, earliest, latest,
  the values themselves ("show original", as text) and the percentage of
  related rows empty or not (an unchecked checkbox is empty), over a relation. A view's rows are rolled up together: one query per
  rollup property, whatever the number of rows.
- **People** (`person`): members of the workspace and its guests (who hold a
  page of it), as a write checks them (`property-references.ts`). Its editors
  list them with their profiles (`GET /databases/:id/people`, `people.ts`) to
  pick from.
- **IDs** (`unique_id`): numbered by the server (`databases.next_row_number`),
  existing rows too when the property is added; clients never write them.
- **Buttons** (`button`): no value; `config.actions` (open a link, set a
  property of the row to a value its type holds, add a row), checked when
  saved and run by the app in order. Writes to one are refused.

## Properties

A database's properties are in the order of its schema
(`PUT /databases/:id/properties/order`). A status property's options are each
in one of three groups, To-do, In progress and Complete (`config.groups`, in
that order, kept whole by the server; an option in none goes to To-do).

Changing a property's type converts every row's value the new type can hold
and clears the rest, in the same write (`property-conversion.ts`): anything
reads as text; text spelling a number, an ISO date or a yes becomes one; text
becomes options (missing ones added, matched by name); option types keep their
option ids. A computed property becoming a stored one keeps what it showed.
The views' filters on the property go (their operators and values were the old
type's); the Name is always text.

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

Table, board, calendar, gallery, list, timeline, form and chart. A new view starts
on what it needs when the request leaves it open: a board grouped by the first
status (else select, else checkbox), a calendar and a timeline on the first
date, a gallery of page covers. A view's rows are
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

**Groups.** A table or a list grouped (`groupBy`), and a board sub-grouped
(`subGroupBy`, its rows of columns), page group by group: the group's order
is the keyset's first key (options as listed, a status's in its groups'
order; checked before unchecked; dates by day, week, month or year, in the
reader's `?timeZone=` when they have a time; text and people as text sorts),
the empty group last. A row with several labels or people comes once per
group (a lateral join), each row carries its `groupKey`, and the response
the `groups` with their counts — every option, even one no row holds
(`hideEmpty` is the app's). `groups.ts` is the JS reference.

**Calculations and charts.** A table's footer (`config.calculations`) and a
chart view (`config.chart`: bars, a line or a donut; an x-axis grouped as
above; a count, sum or average) are computed over every row the view shows,
searched, not the page loaded (`GET …/views/:viewId/calculations`,
`…/chart`), in SQL but for formulas and rollups (`calculations.ts`); the
functions each type takes are the contracts' `CALCULATIONS_BY_TYPE`.
`view-query.pgdb.test.ts` holds both SQL paths to their JS on random views.

**Layout.** A view keeps where it opens rows (`openIn`: a side or centre
peek — the row's properties and page in a sheet — or the full page), its
own property order (`propertyOrder`, over the database's) and a table's
column widths. A removed or retyped property leaves none of these behind.

A database's own
views are its editors' to change. An `inline_database` block showing a
database from elsewhere is a **linked view**: it has views of its own
(`database_views.block_id`, gone with the block), kept by whoever may edit
the block's page as long as they may open the database.

## Locking

A locked database (`databases.locked`, `PATCH /databases/:id { locked }`)
refuses changes to its properties and its own views with 423
`DATABASE_LOCKED`, and two-way relations to it, until it is unlocked; its rows,
name, icon and cover stay editable, and linked views are their block's.

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
