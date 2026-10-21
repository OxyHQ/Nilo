# Workspace and page-tree exports

`GET /workspaces/:id/export?format=md|html` exports the live content the
member can open. `GET /pages/:id/export?format=md|html&subpages=true`
exports that page and its descendants; a database row is a page and can be
the root of this operation. Both return a ZIP built by
`apps/api/src/lib/export-zip.ts`.

## Documents, databases and paths

Each page contributes a Markdown or HTML document. Its same-named folder
contains its children, including databases whose `parentPageId` names that
page. A database contributes a CSV and a same-named folder containing its
row documents. Those documents retain their own subpages and nested databases.
A full-page database sits at the root when it has no parent page.

For example, a project with a Tasks database and a task containing Details
exports these paths:

```text
Project.md
Project/Tasks.csv
Project/Tasks/First task.md
Project/Tasks/First task/Details.md
```

In HTML mode the page documents use `.html`; database tables remain CSV.
Names use the existing cross-platform filename sanitizer. Pages and databases
share a case-insensitive sibling namespace, including their folders; collisions
receive ` (2)`, ` (3)`, and so on. Sanitizing a filename does not change the
page's title or its CSV cell values.
Windows-reserved device basenames receive an underscore prefix, and trailing
periods/spaces are removed before assigning folders and resolving collisions;
see [Windows naming conventions](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file).

CSV uses the same stored-property conversion as the standalone database export:
UTF-8 BOM, CRLF records, spreadsheet formula escaping, display values for
selects and dates, and omission of computed formulas and rollups. ZIP export
does not apply a view's filters or pagination. Its embedded database tables
reuse the authorized rows loaded for the CSV. Existing page-link and synced-block
serialization continues to enforce access through `exportContext`.

## Authorization and completeness

The export first builds its complete inventory with the canonical page and
database access rules. It excludes templates, archived pages and archived
databases, including the descendants of archived database rows whose page
flags are still live. Restrictions on individual rows apply to their body
files and to the database CSV.

A grant to one row does not grant access to its database. If a caller can read
only that row, its document becomes a root without revealing the database's
name, schema, CSV or other rows. A page-tree export never walks upward to
include inaccessible ancestors.

The request limit is **500 page documents and database CSVs combined**.
Inventory over that limit raises `ExportTooLarge`; the HTTP routes return
`413` with `code: EXPORT_TOO_LARGE`. There is no successful, silently truncated
ZIP. The internal `pages` result counts page documents, excluding CSV files.

Only after authorization and the limit check does the exporter run the
canonical page projector for each included page. This flushes acknowledged
Yjs edits into the block representation before reading row bodies and
last-edited-time CSV properties. Projection failure aborts the export rather
than returning stale content. Reads across the whole workspace are not a
single point-in-time snapshot of concurrent edits or permission changes.

## Attachment boundary

This ZIP contains documents and CSVs, not downloaded attachment binaries.
The existing serializers preserve attachment names or supported external
references; they do not create durable links from temporary signed storage
URLs. Export must not acquire storage credentials or turn arbitrary URLs into
server-side downloads. A portable attachment bundle needs a separate design
for authorized file enumeration, safe fetching, limits and archive paths.

The document/row-body structure follows the behavior described in
[Notion's export documentation](https://www.notion.com/en-gb/help/export-your-content).
This does not claim that Nilo's ZIP is a complete, lossless Notion backup.

## Verification

`apps/api/src/lib/__tests__/export-zip.pgdb.test.ts` exercises actual PostgreSQL
permissions and ZIP contents: Markdown/HTML page trees, full-page databases,
row-root export, restricted and individually shared rows, archived database
subtrees, pending Yjs edits, filename collisions, CSV semantics, more rows than
a view page and the exact combined request limit. It runs in the API's existing
`test:pgdb` CI job.
