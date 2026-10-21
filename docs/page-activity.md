# Page activity

Page activity records changes that actually committed, independently of saved
content versions. `page_activity` is a PostgreSQL table owned by Nilo. Existing
pages receive no fabricated creation or edit events when this feature is installed.
An empty feed means no captured events, not that the page has never changed.

## Reading and authorization

`GET /pages/:id/activity?limit=20&cursor=…` returns the shared `PageActivityPage`
contract from `packages/contracts/src/page-activity.ts`: `items` and `nextCursor`.
The limit is 1–50, default 20. Events are newest first by `(createdAt, id)`; the
opaque continuation is bound to the requested page. Malformed, oversized, or
cross-page cursors return 400. A fresh first page is required to see newer events;
pagination is not a frozen database snapshot.

The endpoint uses `checkPageAccess(..., 'editor')` before reading history. Direct
and inherited grants follow the same canonical policy as version history.
Authentication is required; denied or nonexistent pages produce the access
owner's 403 response. Reader/commenter roles can still use current page metadata,
but cannot retrieve these historical values. Changing a role applies to the next
request. Client history caches must hide and discard denied results.

Property changes expose their property ID and old/new row values. An optional
`property` contains the display schema captured when the change was committed:
name, type, and selected formatting options. The endpoint includes this snapshot
only when the caller can also read the database under `resolveDatabaseRole`.
A grant to a single row does not expose its database's field names or option
labels. The snapshot never contains database names, relation targets, formulas,
button actions, or parent paths. Clients must not interpret old option IDs or
values using a subsequently renamed or retyped property. Missing historical
schema uses a generic presentation instead of guessing.

## Capture owners and transactions

- `createPage` stores a `created` event in the page creation transaction, including
  callers that create database rows. The authenticated creator/owner is recorded;
  anonymous form submissions have no attributed user.
- `updatePage` locks the actual row, performs its metadata/property update, then
  compares before and after within the same transaction. Metadata changes and
  property changes are separate events. Repeated identical values and ordering
  changes do not emit events. An outer rollback also rolls back the events.
- `projectPage` records `content_edited` only when its materialized blocks change,
  in the same transaction as the blocks and projection checkpoint. Actors are the
  distinct non-system actors of accepted Yjs updates in that projection interval.
  One event may have several actors. Reprojecting an unchanged document is a
  no-op. A content event contains no invented text diff and is not a snapshot.

Metadata capture covers title, icon, cover, cover position, parent/teamspace,
archive/template flags, full width, small text, font, mode, and lock state. Property
changes capture only changed keys. JSON object key order alone is not a change.
Personal favorites, permissions, publication settings, bulk system-note updates,
property-schema deletion, computed values, reciprocal relation updates, and
subtree archive cascades are not a complete audit trail in this implementation.
Creation and later updates through the listed owners remain observable even when
other operations on the same resource are outside this scope.

No actor is inferred from `lastEditedBy` when a caller does not supply one for the
current operation. Unattributed events have `actorIds: []`; consumers must not
present them as performed by the previous editor. Authors are IDs resolved by the
existing profile owner, not copied profile records or assumed workspace members.

## Invalidation and lifetime

Page metadata writers already announce `workspace:changed`; content projection
emits `page:projected` only after commit to its authorized page room, including
across Socket.IO nodes. Activity consumers invalidate their workspace/page-scoped
query on those events. Neither notification carries historical values. A socket
notification is an invalidation hint; the authenticated endpoint remains the
source of truth and rechecks permission.

Events cascade on permanent page deletion. Soft deletion retains them. The
migration creates only the new table, foreign key and pagination index, with no
changes to existing page/file triggers. It is an additive pre-deployment migration.

Tests cover actual changes and no-ops, rollback, competing writers, cursor ties
and invalid bounds, inherited/direct grants and downgrade, isolated row access,
historical property labels, deletion, and idempotent multi-author projection.
