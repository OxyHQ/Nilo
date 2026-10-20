# Breadcrumb navigation neighbors

`GET /pages/:id/neighbors` and `GET /databases/:id/neighbors` require an authenticated
session and read access to the anchor resource. They return `NavigationNeighbors`
from `@oxy.so/nilo-contracts`: `items` containing `kind`, `id`, `title`, nullable
`icon`, `href`, and `current`, plus nullable `nextCursor`. `current` identifies the
queried anchor, not the browser's current route. It appears on the page of results
containing that resource; the server does not duplicate it onto every page.

`limit` defaults to 6 and accepts integers from 1 to 30. Pass `nextCursor` unchanged
as `cursor` for subsequent results. Destinations sort by immutable ID, then kind
(database before page on a tie), independently of mutable titles and sidebar
presentation. A rename or deletion before the cursor cannot shift an offset.
Moving the anchor to a different location invalidates its cursor with HTTP 400;
restart from the first page. Newly inserted resources before a cursor require a
fresh first-page read. Cursors contain no raw ancestor, owner, or workspace IDs
and never grant access.

Ordinary pages and databases share siblings with the same parent. Root resources
share the same teamspace, or the same owner for private roots. Database rows share
only their database's rows. A caller who can open one row but cannot read its
database receives only that row, without enumerating the database. Templates and
archived resources are excluded. The canonical page/database access resolvers
apply inherited grants, restrictions, teamspace membership, and private ownership.

The server reads bounded keyset batches from the relevant sibling scope and checks
permissions before counting the response limit. It continues past inaccessible
candidates, unlike a fixed over-fetch pool. It never loads the whole workspace to
build a navigation menu. A read-only repeatable-read transaction keeps each request's
resource locations and permissions consistent; every continuation reauthorizes.
Sparse grants over a large sibling set can still require multiple batches and
permission checks. The cursor represents only the last returned destination.

Invalid inputs return 400; missing authentication returns 401; denied anchors
return 403; unavailable anchors return 404. Clients must remove cached menu data
when access ends. Responses are metadata for navigation, not an offline page cache.

Regression coverage lives in `navigation.routes.pgdb.test.ts`: mixed destinations,
private candidates ahead of permitted results, row-only guests, restricted rows,
teamspace/workspace boundaries, cursor ties, revocation, and moving an anchor.
