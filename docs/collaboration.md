# Editing and real-time collaboration

How a page's blocks are edited, saved and kept the same for everyone who has
the page open. The editor is `@oxy.so/bloom-editor` (Bloom repo); Nilo's side
is `apps/app/lib/editor/` and `apps/api/src/lib/block-transactions.ts`.

## One way to write blocks

Blocks are written only by **block transactions**:
`POST /pages/:pageId/blocks/transactions { ops, key?, socketId? }`, applied by
`applyBlockTransaction`. Restoring a page version, importing and the editor
all go through it. There are no REST routes that write single blocks.

Operations: `insert { id, parentBlockId, afterId, type, content }`,
`update { id, type?, content? }`, `move { id, parentBlockId, afterId }`,
`remove { id }`. Ids are client-minted UUIDv7s. Content is normalized by the
shared contract (`@nilo/contracts` `normalizeContent`), which also defines
each block type's fields and defaults.

## The server owns order

Positions are anchors ("after this block"), never numbers. The server turns
an anchor into an `order` against its own state (`placeAfter` in
`@nilo/contracts`), renumbering siblings when two orders leave no room, and
answers with the operations **as applied** — every order it wrote, including
renumberings as `reorder` operations. Siblings sort by `(order, id)`.

Clients never invent orders. Each keeps an `OrderBook` of the server's
orders, each tagged with the version that wrote it (an older version never
overwrites a newer one), uses it to place remote changes, and runs
`reconcileOrder` after every remote change so every list is in the server's
order. A two-editor soak against PostgreSQL showed why: client-chosen orders
diverged under concurrency (a renumbering pulled back a block someone had
moved, an order chosen against a stale neighbour survived).

## Serialized per page

A transaction locks its page row first (`lockPage`), so transactions on one
page run one after another and each validates against what the previous one
committed. The page's `blocksVersion` goes up by one per transaction; the
page room broadcasts `{ version, ops }` to everyone but the sender
(`socketId`).

## Two people in one block

A text change replaces a block's content whole, so on its own the last one
saved would win. Two things keep both people's words:

- The client merges. Rebasing a pending change over a remote one, resuming
  saved work, undo and redo all apply a text change to the block's text as
  it is now, three-way (`mergeText` in `@oxy.so/bloom-text`): only that
  person's own change goes in or comes out.
- The server refuses what it would overwrite. Each block keeps the version
  that last wrote its content (`blocks.content_version`); an update carries
  the version it was made on (`baseVersion`, from the `OrderBook`). Made on
  an older one, it is refused with 409 `STALE_BLOCK`; the session sends it
  again as soon as the newer version arrives, merged into it.

`e2e/live-editing.test.ts` types in one block from two editors at once
against PostgreSQL and checks both texts are kept.

## Idempotent retries

The editor sends a `key` per transaction, the same on every retry. The
server records `(page, key) → { version, ops }` in `page_transactions` (one
day) and answers a repeated key from the record without applying it again —
a lost response no longer leads to a double apply or a refused retry that
undoes a saved change.

## The client session

`SyncSession` (Bloom) holds local transactions until the server confirms
them, rebases them over remote ones by anchors, folds confirmations and
remote versions in version order (holding early arrivals), retries with
backoff and undoes what the server refuses. `snapshot()` / `resume` hand the
unconfirmed work to a new session, resent under the same keys.

## Read-only pages

Viewers and commenters have no session: `RemoteFollower`
(`lib/editor/follower.ts`) applies the room's transactions to their store in
version order and asks for a reload on a skipped version. Their own changes
(a closed toggle) stay on the device.

## Reloads and offline work

`usePageEditor` reloads the page when the session cannot reconcile (a
skipped version, a change that no longer applies) or when a reconnect finds
the page ahead. A reload hands over everything not yet confirmed: the old
session's pending changes and anything typed while the page loads. Remote
changes that arrive during the load wait and are applied on top of what was
loaded (those newer than its version), so none is missed.

With pending changes the page loads through
`POST /pages/:pageId/blocks/resume { keys }`, which answers the blocks, their
version and which of those keys the blocks already include (applied, the
answer lost) in one snapshot. Those are dropped, not applied twice; without
this, re-applying an insert the blocks already have reads as a refused change.

While changes are pending, the session's snapshot is kept on the device
(`lib/editor/offline.ts`, AsyncStorage) and removed once they are saved.
Opening the page without a connection uses it; with a connection, its changes
are resumed as above. Saved work is used only while the server still
remembers the keys of what it applied (`TRANSACTION_KEY_RETENTION_MS` in
`@nilo/contracts`, one day, less an hour), dated by its oldest change: past
that, resending could apply a change twice over later edits.

## Mentions

A person mentioned in a page's text (`mention.attributes.kind === 'user'`)
who was not mentioned anywhere on it before gets a `mention` notification
when the editor saves — if they can open the page, and never the writer.
`applyBlockTransaction` reports them (`mentioned`); only the editor's route
notifies, so imports and restores do not.

## Page history

Before the first change after ten quiet minutes, and before every restore,
`applyBlockTransaction`'s `beforeChange` hook keeps the page's blocks as a
version (`page_versions`, newest 200). A restore is computed against the
locked page and applied as one transaction (block ids kept, so comment
anchors stay), so open editors receive it live.

## Tests

- `apps/app/lib/editor/__tests__/wire.test.ts` — the wire conversion against
  an in-memory server with the API's semantics.
- `e2e/live-editing.test.ts` — two editors wired as the app wires them,
  against the real endpoint, room and PostgreSQL, with seeded random
  concurrent edits and lost responses. `LIVE_SEEDS=1,2,3 LIVE_STEPS=200` runs a
  longer soak; `LIVE_TRACE=<dir>` keeps a failing run's exchange.
